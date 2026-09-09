/**
 * Lead phase 2 — TRIAGE.
 *
 * One AI call per fetched info@ thread: is this a real lead, where does it
 * belong, and what are the decision facts. Writes exactly one `leads` row per
 * thread.
 *
 * Rejected threads are written too, with status='spam' and the model's reason,
 * rather than being dropped. That is deliberate: a filter you cannot audit is a
 * filter you cannot trust, and the "Show filtered" toggle in the UI is how a
 * missed bid gets caught. They cost nothing — nothing downstream reads them.
 *
 * Structured like summarize-phase.ts: time-budgeted rather than count-budgeted,
 * commits after every thread, newest-first, and safe to kill at any moment.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  LEAD_TRIAGE_SYSTEM_PROMPT,
  LEAD_TRIAGE_PROMPT_VERSION,
  LEAD_ROUTES,
  type LeadTriage,
  type LeadTriageBatch,
  type LeadRoute,
} from '@/lib/ai/prompts/lead-triage'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { sweepDb, type EmailThreadRow } from '@/lib/email-sweep/db'
import { leadsDb } from './db'

/** Matches the deal-side cap: ~40k chars is ~10k tokens on the local model. */
const MAX_THREAD_CHARS = 40_000

const BATCH = 25

export interface TriageProgress {
  processed: number
  /** Threads that yielded more than one opportunity. */
  split: number
  leads: number
  rejected: number
  failed: number
  remaining: number
  byRoute: Record<LeadRoute, number>
  outOfTime: boolean
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []
}

/**
 * Accept only a real ISO calendar date. The model is asked for YYYY-MM-DD and
 * told not to guess; anything else (a bare year, "TBD", a US-format date) is
 * dropped rather than stored wrong — a bogus bid date would sort to the top of
 * the queue and misrepresent urgency.
 */
function isoDate(v: unknown): string | null {
  const s = nullableStr(v)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

function route(v: unknown): LeadRoute {
  return LEAD_ROUTES.includes(v as LeadRoute) ? (v as LeadRoute) : 'unknown'
}

/**
 * Coerce whatever the model returned into a list of opportunities.
 *
 * Tolerant of both shapes on purpose: prompt 2.0 asks for `{leads:[...]}`, but a
 * local model occasionally answers in the 1.0 single-object form, and losing a
 * real bid invitation to a shape mismatch is far worse than accepting either.
 */
function normalizeBatch(raw: unknown, fallbackTitle: string): LeadTriage[] {
  const batch = (raw ?? {}) as Partial<LeadTriageBatch>
  const list = Array.isArray(batch.leads) ? batch.leads : [raw]

  const normalized = list
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalize(item, fallbackTitle))
  if (normalized.length === 0) return [normalize(raw, fallbackTitle)]

  // A rejection is a statement about the whole thread, so it cannot be one of
  // several. If the model marked anything as spam alongside real leads, trust
  // the leads and drop the rejection.
  const real = normalized.filter((n) => n.is_lead)
  return real.length > 0 ? real : normalized.slice(0, 1)
}

function normalize(raw: unknown, fallbackTitle: string): LeadTriage {
  const r = (raw ?? {}) as Partial<LeadTriage>
  const isLead = r.is_lead === true

  return {
    is_lead: isLead,
    spam_reason: isLead ? null : nullableStr(r.spam_reason) ?? 'Not a lead.',
    // A route on a rejected thread is meaningless and would show up in the
    // route tab counts.
    route: isLead ? route(r.route) : 'unknown',
    title: nullableStr(r.title) ?? fallbackTitle,
    sender_name: nullableStr(r.sender_name),
    sender_email: nullableStr(r.sender_email)?.toLowerCase() ?? null,
    sender_company: nullableStr(r.sender_company),
    sender_phone: nullableStr(r.sender_phone),
    summary: nullableStr(r.summary) ?? '',
    scope: nullableStr(r.scope),
    location: nullableStr(r.location),
    sector: nullableStr(r.sector),
    estimated_value:
      typeof r.estimated_value === 'number' && isFinite(r.estimated_value) && r.estimated_value >= 0
        ? r.estimated_value
        : null,
    solicitation_number: nullableStr(r.solicitation_number),
    bid_due_date: isoDate(r.bid_due_date),
    site_visit_date: isoDate(r.site_visit_date),
    rfi_due_date: isoDate(r.rfi_due_date),
    key_facts: strings(r.key_facts),
    requirements: strings(r.requirements),
    confidence: typeof r.confidence === 'number' && isFinite(r.confidence) ? r.confidence : 0,
  }
}

type PendingThread = Pick<
  EmailThreadRow,
  'id' | 'subject' | 'raw_markdown' | 'last_at' | 'mailbox' | 'participants'
>

/**
 * Triage pending lead threads until the time budget runs out.
 *
 * @param budgetMs Stop starting new threads once this much time has passed. The
 *                 in-flight thread still finishes, so leave headroom under any
 *                 hard timeout above this.
 */
export async function triagePendingLeads(
  opts: { budgetMs?: number; maxThreads?: number; userId?: string } = {}
): Promise<TriageProgress> {
  const budgetMs = opts.budgetMs ?? 30 * 60 * 1000
  const maxThreads = opts.maxThreads ?? Infinity
  const userId = opts.userId ?? SYSTEM_USER_ID
  const threadsDb = sweepDb()
  const db = leadsDb()
  const deadline = Date.now() + budgetMs

  const progress: TriageProgress = {
    processed: 0,
    split: 0,
    leads: 0,
    rejected: 0,
    failed: 0,
    remaining: 0,
    byRoute: { steel: 0, dino: 0, construction: 0, corporate: 0, unknown: 0 },
    outOfTime: false,
  }

  while (progress.processed < maxThreads) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    // Newest first — a bid invitation that arrived this morning matters more
    // than one from three months ago, which has probably already closed.
    const { data, error } = await threadsDb
      .from('email_threads')
      .select('id, subject, raw_markdown, last_at, mailbox, participants')
      .eq('pipeline', 'lead')
      .eq('summary_state', 'pending')
      .order('last_at', { ascending: false })
      .limit(BATCH)

    if (error) throw new Error(`Could not load pending lead threads: ${error.message}`)
    const rows = (data ?? []) as PendingThread[]
    if (rows.length === 0) break

    for (const row of rows) {
      if (Date.now() >= deadline || progress.processed >= maxThreads) {
        progress.outOfTime = Date.now() >= deadline
        break
      }

      const text = (row.raw_markdown ?? '').slice(0, MAX_THREAD_CHARS)
      if (!text.trim()) {
        await threadsDb
          .from('email_threads')
          .update({ summary_state: 'skipped', summary_error: 'Thread had no readable text.' })
          .eq('id', row.id)
        progress.processed++
        continue
      }

      try {
        const { data: raw } = await callGemini<Partial<LeadTriageBatch>>({
          task: 'lead-triage',
          systemPrompt: LEAD_TRIAGE_SYSTEM_PROMPT,
          userMessage: text,
          userId,
          promptVersion: LEAD_TRIAGE_PROMPT_VERSION,
          maxTokens: 4096,
        })

        if (!raw || typeof raw !== 'object') throw new Error('Model did not return JSON.')

        const found = normalizeBatch(raw, row.subject ?? '(no subject)')
        if (found.length > 1) progress.split++

        for (const [index, t] of found.entries()) {
        // Upsert on (thread_id, thread_item) so a re-triage corrects each
        // opportunity in place rather than stacking duplicates in the queue.
        const { error: upsertErr } = await db.from('leads').upsert(
          {
            thread_id: row.id,
            thread_item: index,
            mailbox: row.mailbox,
            route: t.route,
            status: t.is_lead ? 'new' : 'spam',
            spam_reason: t.spam_reason,
            title: t.title,
            received_at: row.last_at,
            sender_name: t.sender_name,
            sender_email: t.sender_email,
            sender_company: t.sender_company,
            sender_phone: t.sender_phone,
            summary: t.summary,
            scope: t.scope,
            location: t.location,
            sector: t.sector,
            estimated_value: t.estimated_value,
            solicitation_number: t.solicitation_number,
            bid_due_date: t.bid_due_date,
            site_visit_date: t.site_visit_date,
            rfi_due_date: t.rfi_due_date,
            key_facts: t.key_facts,
            requirements: t.requirements,
            triage_confidence: t.confidence,
            // Rejected threads are never scored — that is the whole saving.
            score_state: t.is_lead ? 'pending' : 'skipped',
          },
          { onConflict: 'thread_id,thread_item' }
        )
        if (upsertErr) throw new Error(upsertErr.message)

        if (t.is_lead) {
          progress.leads++
          progress.byRoute[t.route]++
        } else {
          progress.rejected++
        }
        }

        await pruneSurplusLeads(row.id, found.length)

        await threadsDb
          .from('email_threads')
          .update({ summary_state: 'summarized', summary_error: null })
          .eq('id', row.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[leads/triage] thread ${row.id} failed:`, message)
        await threadsDb
          .from('email_threads')
          .update({ summary_state: 'failed', summary_error: message.slice(0, 500) })
          .eq('id', row.id)
        progress.failed++
      }

      progress.processed++
    }
  }

  const { count } = await threadsDb
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('pipeline', 'lead')
    .eq('summary_state', 'pending')
  progress.remaining = count ?? 0

  return progress
}

/**
 * Remove leads left over from a previous, larger reading of the same thread.
 *
 * A re-triage that now finds three opportunities where it once found five must
 * not leave two orphans in the queue. But it must never remove one a person has
 * acted on: a promoted lead is a real record's origin, and an ignored one is a
 * decision someone made. Only untouched rows go.
 *
 * The cost of being wrong here is asymmetric — a stale extra lead is visible and
 * dismissable, whereas deleting a promoted lead severs a project from where it
 * came from — so anything that is not plainly untouched is kept.
 */
async function pruneSurplusLeads(threadId: string, keep: number): Promise<void> {
  const db = leadsDb()
  const { data, error } = await db
    .from('leads')
    .delete()
    .eq('thread_id', threadId)
    .gte('thread_item', keep)
    .in('status', ['new', 'spam'])
    .is('promoted_project_id', null)
    .is('promoted_opportunity_id', null)
    .is('promoted_steel_deal_id', null)
    .is('forwarded_at', null)
    .select('id')

  if (error) {
    console.error(`[leads/triage] could not prune surplus leads on ${threadId}:`, error.message)
    return
  }
  if (data?.length) {
    console.log(`[leads/triage] pruned ${data.length} surplus lead(s) on thread ${threadId}`)
  }
}

/** Requeue lead threads whose triage failed, so a transient outage isn't fatal. */
export async function retryFailedTriage(): Promise<number> {
  const db = sweepDb()
  const { data, error } = await db
    .from('email_threads')
    .update({ summary_state: 'pending', summary_error: null })
    .eq('pipeline', 'lead')
    .eq('summary_state', 'failed')
    .select('id')

  if (error) throw new Error(`Could not requeue failed lead threads: ${error.message}`)
  return data?.length ?? 0
}
