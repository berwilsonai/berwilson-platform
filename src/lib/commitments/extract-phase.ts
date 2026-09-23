/**
 * Sweep phase — extract commitments from summarized threads.
 *
 * Runs after summarize, on threads whose `commitments_at` is null. That marker
 * is cleared wherever `routed_at` and `embedded_at` are, so a conversation that
 * gains a reply is RE-READ: without that, the ledger would keep asserting an
 * obligation that the newest message in the very same thread already settled,
 * which is the fastest possible way to make reminders untrustworthy.
 *
 * COST CONTROL — why most threads never reach the model. A thread whose summary
 * lists no open items is stamped and skipped without an AI call. The summary
 * pass has already read that entire conversation and found nothing outstanding;
 * paying another 20-40 seconds for a second model to disagree with the first is
 * not a good trade at portfolio scale. Measured on live data, this takes the
 * phase from every thread down to a handful a day.
 */

import { callGemini } from '@/lib/ai/gemini'
import { sweepDb } from '@/lib/email-sweep/db'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import {
  COMMITMENT_SYSTEM_PROMPT,
  COMMITMENT_PROMPT_VERSION,
  type CommitmentExtraction,
  type ExtractedCommitment,
} from './prompt'
import { commitmentKey, HUMAN_SETTLED, type CommitmentRow, type CommitmentSide } from './db'

/**
 * How much of the conversation the model reads, taken from the END.
 *
 * The tail is what matters: the most recent messages are where a commitment is
 * either made or discharged, and "is this still open" is unanswerable from the
 * opening of a long thread. Far smaller than the summary pass's 40k budget, so
 * a call here costs well under half what a summary does.
 */
const MAX_TAIL_CHARS = 12_000

/** Below this the model is guessing, and a guessed obligation is worse than none. */
const MIN_CONFIDENCE = 0.5

const BATCH = 25

export interface CommitmentProgress {
  processed: number
  /** Threads that reached the model. */
  examined: number
  /** Threads stamped with no AI call because their summary listed nothing open. */
  skipped: number
  created: number
  updated: number
  /** Open rows the model no longer sees, closed automatically. */
  autoResolved: number
  failed: number
  remaining: number
  outOfTime: boolean
}

interface ThreadForExtraction {
  id: string
  subject: string | null
  raw_markdown: string | null
  last_at: string | null
  summary: unknown | null
}

function normalize(raw: unknown): ExtractedCommitment[] {
  const list = (raw as CommitmentExtraction | null)?.commitments
  if (!Array.isArray(list)) return []

  return list.flatMap((c): ExtractedCommitment[] => {
    const what = typeof c?.what === 'string' ? c.what.trim() : ''
    if (!what) return []

    // Anything not explicitly 'us' is treated as the counterparty's. Erring
    // toward "them" means the failure mode is a follow-up we did not need to
    // chase, rather than silently adopting someone else's obligation as work.
    const side: CommitmentSide = c?.side === 'us' ? 'us' : 'them'

    // Only a real ISO date survives. The model is told never to invent one, and
    // this is the guard that holds when it does anyway.
    const due =
      typeof c?.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.due_date.trim())
        ? c.due_date.trim()
        : null

    const confidence =
      typeof c?.confidence === 'number' && isFinite(c.confidence) ? c.confidence : 0

    return [
      {
        what,
        side,
        owner_name: typeof c?.owner_name === 'string' && c.owner_name.trim() ? c.owner_name.trim() : null,
        due_date: due,
        // Absent means open — a model that forgets the field should leave the
        // item visible, not silently swallow it.
        still_open: c?.still_open !== false,
        confidence,
      },
    ]
  })
}

/** Open items recorded by the summary pass, if any. */
function openItemsOf(summary: unknown): string[] {
  const s = summary as { open_items?: unknown; relevance?: unknown } | null
  return Array.isArray(s?.open_items)
    ? s.open_items.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
}

function relevanceOf(summary: unknown): string {
  const s = summary as { relevance?: unknown } | null
  return typeof s?.relevance === 'string' ? s.relevance : 'noise'
}

export async function extractCommitments(
  opts: { budgetMs?: number; maxThreads?: number; userId?: string } = {}
): Promise<CommitmentProgress> {
  const budgetMs = opts.budgetMs ?? 10 * 60 * 1000
  const maxThreads = opts.maxThreads ?? Infinity
  const userId = opts.userId ?? SYSTEM_USER_ID
  const db = sweepDb()
  const deadline = Date.now() + budgetMs

  const progress: CommitmentProgress = {
    processed: 0,
    examined: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    autoResolved: 0,
    failed: 0,
    remaining: 0,
    outOfTime: false,
  }

  while (progress.processed < maxThreads) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    // Newest first, matching every other phase: a run cut short should have
    // covered this week's obligations, not 2019's.
    const { data, error } = await db
      .from('email_threads')
      .select('id, subject, raw_markdown, last_at, summary')
      .is('commitments_at', null)
      .eq('summary_state', 'summarized')
      .eq('pipeline', 'deal')
      .order('last_at', { ascending: false })
      .limit(BATCH)

    if (error) throw new Error(`Could not load threads for commitments: ${error.message}`)
    const rows = (data ?? []) as ThreadForExtraction[]
    if (rows.length === 0) break

    for (const row of rows) {
      if (Date.now() >= deadline || progress.processed >= maxThreads) {
        progress.outOfTime = Date.now() >= deadline
        break
      }
      progress.processed++

      const relevance = relevanceOf(row.summary)
      const openItems = openItemsOf(row.summary)
      const text = (row.raw_markdown ?? '').slice(-MAX_TAIL_CHARS)

      // The cheap exits, in order: noise carries no obligations worth tracking,
      // a summary with no open items has already been judged as having none,
      // and an unreadable thread has nothing to read.
      if (relevance === 'noise' || openItems.length === 0 || !text.trim()) {
        await db
          .from('email_threads')
          .update({ commitments_at: new Date().toISOString() })
          .eq('id', row.id)
        progress.skipped++
        continue
      }

      try {
        const conversationDate = (row.last_at ?? new Date().toISOString()).slice(0, 10)
        const userMessage = [
          `CONVERSATION DATE: ${conversationDate}`,
          `SUBJECT: ${row.subject ?? '(none)'}`,
          '',
          'ITEMS THE FIRST PASS FLAGGED AS OUTSTANDING:',
          ...openItems.map((i) => `- ${i}`),
          '',
          'MOST RECENT CORRESPONDENCE:',
          text,
        ].join('\n')

        const { data: raw } = await callGemini<CommitmentExtraction>({
          task: 'commitments',
          systemPrompt: COMMITMENT_SYSTEM_PROMPT,
          userMessage,
          userId,
          promptVersion: COMMITMENT_PROMPT_VERSION,
          maxTokens: 2048,
        })

        if (!raw || typeof raw !== 'object') throw new Error('Model did not return JSON.')

        const extracted = normalize(raw).filter(
          (c) => c.still_open && c.confidence >= MIN_CONFIDENCE
        )

        await reconcileThread(db, row.id, extracted, progress)
        progress.examined++

        await db
          .from('email_threads')
          .update({ commitments_at: new Date().toISOString() })
          .eq('id', row.id)
      } catch (err) {
        progress.failed++
        // Stamped even on failure, so one unreadable thread cannot be retried
        // forever at the front of the queue and starve everything behind it.
        // A thread that later grows is re-queued anyway by the normal marker
        // reset, which is the retry that actually matters.
        await db
          .from('email_threads')
          .update({ commitments_at: new Date().toISOString() })
          .eq('id', row.id)
        console.warn(`[commitments] thread ${row.id} failed:`, err instanceof Error ? err.message : err)
      }
    }
  }

  const { count } = await db
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .is('commitments_at', null)
    .eq('summary_state', 'summarized')
    .eq('pipeline', 'deal')
  progress.remaining = count ?? 0

  return progress
}

/**
 * Fold a fresh reading into what the ledger already holds for this thread.
 *
 * Three rules, and the third is the one that matters:
 *   - a key the ledger has not seen becomes a new open row;
 *   - a key it has seen is refreshed in place (the date may have firmed up);
 *   - a row a HUMAN settled is never touched, in either direction.
 *
 * Without the third rule every sweep would silently reopen work somebody had
 * already closed, and the ledger would argue with its own users once an hour.
 */
async function reconcileThread(
  db: ReturnType<typeof sweepDb>,
  threadId: string,
  extracted: ExtractedCommitment[],
  progress: CommitmentProgress
): Promise<void> {
  const { data: existingRaw } = await db
    .from('commitments')
    .select('id, item_key, status')
    .eq('thread_id', threadId)

  const existing = (existingRaw ?? []) as Pick<CommitmentRow, 'id' | 'item_key' | 'status'>[]
  const byKey = new Map(existing.map((r) => [r.item_key, r]))

  // Scope the ledger to whatever record the thread is already filed against, so
  // a commitment shows up on the deal it belongs to. Read from thread_links
  // rather than guessed — an unfiled thread simply has no scope, which is
  // correct and common.
  const { data: linkRaw } = await db
    .from('thread_links')
    .select('record_kind, record_id')
    .eq('thread_id', threadId)
    .limit(5)
  const links = (linkRaw ?? []) as { record_kind: string; record_id: string }[]
  const projectId = links.find((l) => l.record_kind === 'project')?.record_id ?? null
  const opportunityId = links.find((l) => l.record_kind === 'opportunity')?.record_id ?? null

  const seen = new Set<string>()

  for (const c of extracted) {
    const key = commitmentKey(c.what)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const prior = byKey.get(key)

    // A human already ruled on this one. Their decision stands.
    if (prior && HUMAN_SETTLED.includes(prior.status)) continue

    const fields = {
      what: c.what,
      side: c.side,
      owner_name: c.owner_name,
      due_date: c.due_date,
      confidence: c.confidence,
      project_id: projectId,
      opportunity_id: opportunityId,
      status: 'open' as const,
    }

    if (prior) {
      const { error } = await db.from('commitments').update(fields).eq('id', prior.id)
      if (!error) progress.updated++
    } else {
      const { error } = await db
        .from('commitments')
        .insert({ thread_id: threadId, item_key: key, ...fields })
      if (!error) progress.created++
    }
  }

  // Anything still open that this reading no longer sees has been met, dropped,
  // or overtaken. Closed as `resolved` rather than deleted: the row is the
  // evidence of what was tracked and when it stopped mattering.
  const stale = existing.filter((r) => r.status === 'open' && !seen.has(r.item_key))
  if (stale.length > 0) {
    const { error } = await db
      .from('commitments')
      .update({ status: 'resolved' })
      .in('id', stale.map((r) => r.id))
    if (!error) progress.autoResolved += stale.length
  }
}
