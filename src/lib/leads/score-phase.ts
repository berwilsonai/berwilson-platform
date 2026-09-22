/**
 * Lead phase 3 — SCORE.
 *
 * Runs only on threads that survived triage, which is the point: pulling
 * attachments costs a Gmail round trip per file (Gmail, unlike Graph, does not
 * inline bytes) and the fit assessment costs a model call with the whole company
 * profile in context. Neither is worth spending on a newsletter.
 *
 * Three steps per lead:
 *   1. Download the thread's real attachments and stage them in the documents
 *      bucket, so the RFP survives even if the mail is later deleted.
 *   2. Extract their text LOCALLY — unpdf for PDFs, mammoth for .docx. In local
 *      mode neither costs a model call, so reading a 200-page RFP is nearly free.
 *   3. Run assessFit() unchanged. It already grounds itself in the company
 *      profile plus retrieved evidence from the company knowledge base, and
 *      returns the score/summary/strengths/concerns/gaps/questions shape the UI
 *      already knows how to render.
 *
 * A web-form lead has no thread; its evidence is the Drive folder the deal form
 * created. Steps 1-2 are replaced by reading that folder's text in memory —
 * step 3 is identical, which is the point of scoring both sources here rather
 * than building a second assessor.
 */

import { assessFit } from '@/lib/ai/fit-assessment'
import type { ProposalExtraction } from '@/lib/ai/proposal-matching'
import { transcribePdfText, extractDocxText } from '@/lib/ai/document-text'
import { documentKind } from '@/lib/ai/document-pipeline'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchThread, fetchAttachmentBytes } from '@/lib/integrations/google-workspace'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { sweepDb, type EmailThreadRow } from '@/lib/email-sweep/db'
import { readDriveFolderText } from '@/lib/drive/import'
import { leadsDb, type LeadAttachment, type LeadRow } from './db'

/** Where staged lead files live in the documents bucket. */
export const LEAD_FOLDER = 'leads'

/** Skip anything bigger — a 40MB drawing set is not worth the round trip. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Attachments pulled per lead. Bid packages routinely carry dozens. */
const MAX_ATTACHMENTS = 8

/** Extracted attachment text handed to the assessor, across all files. */
const MAX_ATTACHMENT_TEXT = 60_000

const BATCH = 10

export interface ScoreProgress {
  processed: number
  scored: number
  failed: number
  remaining: number
  attachmentsStaged: number
  outOfTime: boolean
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

/**
 * Download, stage, and read one lead's attachments.
 *
 * Never throws: a lead with unreadable files is still worth scoring from the
 * email body alone, so failures degrade to a shorter evidence block.
 */
async function stageAttachments(
  lead: Pick<LeadRow, 'id'>,
  thread: Pick<EmailThreadRow, 'mailbox' | 'gmail_thread_id'>
): Promise<{ attachments: LeadAttachment[]; text: string }> {
  const staged: LeadAttachment[] = []
  const chunks: string[] = []

  try {
    const messages = await fetchThread(thread.mailbox, thread.gmail_thread_id)
    const supabase = createAdminClient()

    const refs = messages
      .flatMap((m) => m.attachments)
      .filter((a) => !a.isInline && a.size > 0 && a.size <= MAX_ATTACHMENT_BYTES)

    // Bid packages resend the same drawing on every reply — dedupe on
    // name+size before paying for the download.
    const seen = new Set<string>()
    const unique = refs.filter((a) => {
      const key = `${a.name}:${a.size}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    for (const ref of unique.slice(0, MAX_ATTACHMENTS)) {
      try {
        const base64 = await fetchAttachmentBytes(thread.mailbox, ref.messageId, ref.attachmentId)
        if (!base64) continue
        const buffer = Buffer.from(base64, 'base64')

        const path = `${LEAD_FOLDER}/${lead.id}/${Date.now()}-${sanitizeFileName(ref.name)}`
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(path, buffer, { contentType: ref.mimeType || 'application/octet-stream' })
        if (uploadErr) {
          console.error(`[leads/score] could not stage ${ref.name}:`, uploadErr.message)
          continue
        }

        // Local extraction — no model call in local mode for either branch.
        let text: string | null = null
        const kind = documentKind(ref.mimeType, ref.name)
        if (kind === 'pdf') {
          text = await transcribePdfText({
            dataBase64: base64,
            byteLength: buffer.byteLength,
            fileName: ref.name,
            userId: SYSTEM_USER_ID,
          })
        } else if (kind === 'docx') {
          text = await extractDocxText(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
          )
        } else if (kind === 'text') {
          text = buffer.toString('utf8')
        }

        if (text?.trim()) chunks.push(`### Attachment: ${ref.name}\n\n${text.trim()}`)

        staged.push({
          name: ref.name,
          mime_type: ref.mimeType || null,
          size_bytes: ref.size,
          storage_path: path,
          extracted: !!text?.trim(),
        })
      } catch (err) {
        console.error(
          `[leads/score] attachment ${ref.name} failed:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  } catch (err) {
    console.error(
      '[leads/score] could not read thread attachments:',
      err instanceof Error ? err.message : String(err)
    )
  }

  return { attachments: staged, text: chunks.join('\n\n').slice(0, MAX_ATTACHMENT_TEXT) }
}

/**
 * Shape a triaged lead into what assessFit already knows how to read.
 *
 * The assessor was built for the proposal wizard, so this adapts rather than
 * duplicating it — one scoring model, one prompt, one place to tune.
 */
export function toProposalExtraction(lead: LeadRow, attachmentText: string): ProposalExtraction {
  const scope = [lead.scope, attachmentText].filter(Boolean).join('\n\n')

  return {
    document_type: 'single_project_proposal',
    intake_summary: lead.summary ?? lead.title,
    developer_company: lead.sender_company
      ? {
          name: lead.sender_company,
          description: null,
          location: lead.location,
          website: null,
        }
      : null,
    projects: [
      {
        name: lead.title,
        description: lead.summary,
        sector: lead.sector,
        stage: 'pursuit',
        estimated_value: lead.estimated_value,
        contract_type: null,
        delivery_method: null,
        location: lead.location,
        client_entity: lead.sender_company,
        solicitation_number: lead.solicitation_number,
        award_date: null,
        ntp_date: null,
        substantial_completion_date: null,
        scope_of_work: scope || null,
        key_facts: lead.key_facts,
        confidence: lead.triage_confidence ?? 0.5,
      },
    ],
    parties: lead.sender_name
      ? [
          {
            name: lead.sender_name,
            company: lead.sender_company,
            role: 'Inbound contact',
            email: lead.sender_email,
            phone: lead.sender_phone,
            is_organization: false,
          },
        ]
      : [],
    entities: [],
    risks: [],
    compliance_requirements: lead.requirements,
    // The requirements list is the evidence; absence of the word is not proof
    // bonding is NOT required, so this stays null rather than false.
    bonding_required: lead.requirements.some((r) => /bond/i.test(r)) ? true : null,
    confidence: lead.triage_confidence ?? 0.5,
    field_confidences: {},
  }
}

/**
 * Score leads awaiting assessment until the time budget runs out.
 */
export async function scorePendingLeads(
  opts: { budgetMs?: number; maxLeads?: number; userId?: string } = {}
): Promise<ScoreProgress> {
  const budgetMs = opts.budgetMs ?? 20 * 60 * 1000
  const maxLeads = opts.maxLeads ?? Infinity
  const userId = opts.userId ?? SYSTEM_USER_ID
  const db = leadsDb()
  const threadsDb = sweepDb()
  const deadline = Date.now() + budgetMs

  const progress: ScoreProgress = {
    processed: 0,
    scored: 0,
    failed: 0,
    remaining: 0,
    attachmentsStaged: 0,
    outOfTime: false,
  }

  while (progress.processed < maxLeads) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    const { data, error } = await db
      .from('leads')
      .select('*')
      .eq('score_state', 'pending')
      .neq('status', 'spam')
      // Soonest bid first: if the run is cut short, the leads that are about to
      // close are the ones already scored.
      .order('bid_due_date', { ascending: true, nullsFirst: false })
      .limit(BATCH)

    if (error) throw new Error(`Could not load leads to score: ${error.message}`)
    const leads = (data ?? []) as LeadRow[]
    if (leads.length === 0) break

    for (const lead of leads) {
      if (Date.now() >= deadline || progress.processed >= maxLeads) {
        progress.outOfTime = Date.now() >= deadline
        break
      }

      try {
        let attachments: LeadAttachment[] = []
        let text = ''

        if (lead.source === 'web_form' && lead.drive_folder_id) {
          // A web-form deal's evidence is in its Drive folder. It is read in
          // memory and NOT staged: most submissions are never promoted, and
          // copying every one into the documents bucket would pay storage for
          // deals we pass on. importDriveFolder brings the files in once, at
          // promotion, when they are worth keeping.
          const folder = await readDriveFolderText(lead.drive_folder_id)
          text = folder.text
        } else if (lead.thread_id) {
          const { data: threadData, error: threadErr } = await threadsDb
            .from('email_threads')
            .select('mailbox, gmail_thread_id')
            .eq('id', lead.thread_id)
            .maybeSingle()
          if (threadErr) throw new Error(threadErr.message)

          const thread = threadData as Pick<EmailThreadRow, 'mailbox' | 'gmail_thread_id'> | null
          if (thread) {
            const staged = await stageAttachments(lead, thread)
            attachments = staged.attachments
            text = staged.text
          }
        }
        progress.attachmentsStaged += attachments.length

        const fit = await assessFit(toProposalExtraction(lead, text), userId)

        const { error: updateErr } = await db
          .from('leads')
          .update({
            attachments,
            fit_score: fit?.fit_score ?? null,
            fit_recommendation: fit?.recommendation ?? null,
            fit_summary: fit?.summary ?? null,
            fit_strengths: fit?.strengths ?? [],
            fit_concerns: fit?.concerns ?? [],
            fit_gaps: fit?.gaps ?? [],
            fit_questions: fit?.key_questions ?? [],
            // No company profile means assessFit returns null. That is a
            // configuration gap, not a lead failure — keep the lead, record
            // that it could not be judged.
            score_state: 'scored',
            score_error: fit ? null : 'No company profile — fit could not be assessed.',
          })
          .eq('id', lead.id)
        if (updateErr) throw new Error(updateErr.message)

        progress.scored++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[leads/score] lead ${lead.id} failed:`, message)
        await db
          .from('leads')
          .update({ score_state: 'failed', score_error: message.slice(0, 500) })
          .eq('id', lead.id)
        progress.failed++
      }

      progress.processed++
    }
  }

  const { count } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('score_state', 'pending')
    .neq('status', 'spam')
  progress.remaining = count ?? 0

  return progress
}

/**
 * How long an undated lead is allowed to sit in the queue before it ages out.
 *
 * Thirty days matches retryStaleFailures()' window in the sweep, and the
 * reasoning is the same: a solicitation nobody has acted on in a month is not
 * going to be acted on, and leaving it in the queue only makes the queue the
 * thing people stop opening.
 */
const UNDATED_LEAD_MAX_AGE_DAYS = 30

/** What one drain pass closed, split by reason. */
export interface DrainProgress {
  /** Closed because the bid date passed. */
  expiredDated: number
  /** Closed because an undated lead aged out. */
  expiredUndated: number
  /** Closed because triage judged them out of scope. */
  ignoredPass: number
  /** Closed because an identical job had already been posted. */
  dedupedRepost: number
}

/**
 * Close leads the queue should no longer be asking a human about.
 *
 * ⚠ THE UNDATED RULE IS THE LOAD-BEARING HALF, and its absence is why the
 * queue had 99 open leads with the oldest a month old. The original version
 * filtered `.not('bid_due_date','is',null)` and claimed in its own comment to
 * drain the queue — but a lead with NO bid date can never satisfy a
 * bid-date-in-the-past test, so for those leads the rule never fires. Measured
 * 2026-09-21: 69 of the 73 open `pursue` leads carried no bid date, so the
 * drain reached almost none of the backlog it was written for.
 *
 * Age is measured from `created_at`, deliberately, NOT `updated_at`: the
 * `update_updated_at` trigger fires on re-scoring, re-labelling and Gmail
 * sync, so an undated lead's `updated_at` keeps moving and it would never age
 * out — the same class of mistake as measuring a stalled thread by a column
 * its own writes bump.
 *
 * `pass` leads are closed as `ignored` rather than `expired`: expired means
 * the opportunity itself closed, ignored means we judged it out of scope, and
 * conflating them would make the triage record unreadable. Neither deletes the
 * row — the module's documented posture is that a rejected lead is kept so the
 * filter stays auditable, and `syncLeadLabels()` already maps `ignored` to
 * `Ber AI/Closed` in Gmail.
 *
 * Only `new` and `reviewing` are touched, so a lead a human already promoted
 * or forwarded is never reopened or reclosed by a cron.
 */
export async function drainLeadQueue(): Promise<DrainProgress> {
  const db = leadsDb()
  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - UNDATED_LEAD_MAX_AGE_DAYS * 86_400_000).toISOString()
  const progress: DrainProgress = { expiredDated: 0, expiredUndated: 0, ignoredPass: 0, dedupedRepost: 0 }

  // 1. The bid date has passed — unchanged from the original rule.
  const dated = await db
    .from('leads')
    .update({ status: 'expired' })
    .in('status', ['new', 'reviewing'])
    .not('bid_due_date', 'is', null)
    .lt('bid_due_date', today)
    .select('id')
  if (dated.error) throw new Error(`Could not expire dated leads: ${dated.error.message}`)
  progress.expiredDated = dated.data?.length ?? 0

  // 2. No bid date and old enough that nobody is coming back to it.
  const undated = await db
    .from('leads')
    .update({ status: 'expired' })
    .in('status', ['new', 'reviewing'])
    .is('bid_due_date', null)
    .lt('created_at', cutoff)
    .select('id')
  if (undated.error) throw new Error(`Could not expire undated leads: ${undated.error.message}`)
  progress.expiredUndated = undated.data?.length ?? 0

  // 3. Triage said pass. /decide already hides these, so leaving them `new`
  //    made them invisible work inflating every count on the way past.
  const passed = await db
    .from('leads')
    .update({ status: 'ignored' })
    .in('status', ['new', 'reviewing'])
    .eq('fit_recommendation', 'pass')
    .select('id')
  if (passed.error) throw new Error(`Could not close passed leads: ${passed.error.message}`)
  progress.ignoredPass = passed.data?.length ?? 0

  // 4. The same job, posted twice.
  progress.dedupedRepost = await dedupeOpenLeads()

  return progress
}

/**
 * Strip the parts of a solicitation title that change between postings of the
 * same job, so two rows for one job compare equal.
 *
 * Deliberately conservative. Measured against the live queue on 2026-09-21,
 * this collapses 3 groups — it does NOT catch near-misses like "Chase Bank
 * Branch Ground-Up Development" against "Chase Bank Branch Construction", and
 * that is the intended trade. Those two MIGHT be one job, and a fuzzy matcher
 * that merged them would sometimes merge two genuinely different bid packages
 * instead. The cost is asymmetric in the same way `pruneSurplusLeads()`
 * describes: a surviving duplicate is visible and dismissable in one click,
 * whereas silently closing a distinct bid loses it.
 */
export function normalizeLeadTitle(title: string | null): string {
  return (title ?? '')
    .toLowerCase()
    // Re-posting markers: "Addendum 2", "RFI #4", "REBID", "Revised", "No. 3".
    // The `#` is its own alternative rather than part of the word list because
    // \b cannot match between a space and a '#' — both are non-word characters
    // — so "Addendum #4" would otherwise strip "Addendum" and leave the "4".
    .replace(/(?:\b(?:addend(?:um|a)|rfi|re-?bid|revised|updated?|no)\b\.?|#)\s*#?\s*\d*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Close open leads that repeat a job already open in the queue.
 *
 * Bid invitations arrive repeatedly for one job — the original, then addenda,
 * then "RFI responses" — each as its own email and therefore its own lead.
 * `pruneSurplusLeads()` cannot see this: it reconciles one thread against a
 * re-reading of itself, whereas these are genuinely separate threads.
 *
 * The survivor is the row carrying a BID DATE, then the newest, because a
 * dated addendum is the actionable copy and the undated original is not — the
 * same rule the manual cleanup on 2026-09-15 used.
 *
 * Losers become `ignored`, not deleted: unlike a prune orphan (which was never
 * a real reading), a repost is a real email that really arrived, and the
 * module's posture is that a closed lead is kept so triage stays auditable.
 * No reason column is written — `spam_reason` means the marketing filter and
 * `notes` carries extraction content, so neither can absorb this without
 * corrupting what it already records. The reason is recoverable anyway: the
 * survivor has an identical normalized title.
 */
async function dedupeOpenLeads(): Promise<number> {
  const db = leadsDb()
  const { data, error } = await db
    .from('leads')
    .select('id, title, route, bid_due_date, created_at')
    .in('status', ['new', 'reviewing'])
    .is('promoted_project_id', null)
    .is('promoted_opportunity_id', null)
    .is('promoted_steel_deal_id', null)
    .is('forwarded_at', null)
  if (error) throw new Error(`Could not read leads for dedupe: ${error.message}`)
  if (!data?.length) return 0

  // Route is part of the key: the same building described to the steel line and
  // to the construction line is two different pursuits, not one duplicate.
  const groups = new Map<string, typeof data>()
  for (const row of data) {
    const key = `${row.route ?? ''}::${normalizeLeadTitle(row.title)}`
    if (!key.endsWith('::')) groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const losers: string[] = []
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    const [, ...rest] = [...rows].sort((a, b) => {
      if (Boolean(a.bid_due_date) !== Boolean(b.bid_due_date)) return a.bid_due_date ? -1 : 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
    losers.push(...rest.map((r) => r.id))
  }
  if (!losers.length) return 0

  const { data: closed, error: closeErr } = await db
    .from('leads')
    .update({ status: 'ignored' })
    .in('id', losers)
    .select('id')
  if (closeErr) throw new Error(`Could not close duplicate leads: ${closeErr.message}`)
  return closed?.length ?? 0
}
