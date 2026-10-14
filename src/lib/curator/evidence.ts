/**
 * What the curator is allowed to read about one record.
 *
 * ⚠ EVIDENCE IS GATHERED BY LINK, NEVER BY NAME. This is the single most
 * important property of this file. §12 records what name-matching costs here
 * twice over: a shared industry word put Bloom Energy's logo on bfaenergy.com,
 * and counting matched tokens let "Stockton Power Nexus - ER Hospital &
 * Medevac Airport Tower" claim a 664-message FAMILY thread on `hospital` +
 * `airport`. A curator that writes to records is strictly worse to get wrong
 * than a logo: it would file one deal's closing date onto another.
 *
 * So the only evidence for a record is evidence somebody or something already
 * attached to it — `thread_links` rows, `meetings.project_id`,
 * `documents.project_id`. Every one of those is either a human filing decision
 * or a deterministic match the router already made and recorded with a reason.
 * The curator inherits that judgement and never second-guesses it.
 *
 * ⚠ AND NOTHING HERE READS MAIL OR CALLS A MODEL TO SUMMARIZE. The sweep has
 * already summarized every thread and the Meet importer every transcript. This
 * reads conclusions — the same property that makes Pepper's morning note
 * affordable on a box that serves one model request at a time.
 */

import { threadSource } from '@/lib/email-sweep/thread-source'
import { provDb } from '@/lib/provenance/db'

/** How much evidence goes into one model call. */
const EVIDENCE_CHARS = Number(process.env.CURATOR_EVIDENCE_CHARS ?? 24_000)

/** How many of each kind, newest first. Bounded so one chatty deal cannot
 *  crowd out the rest of the portfolio inside the character budget. */
const MAX_THREADS = 12
const MAX_MEETINGS = 6
const MAX_DOCUMENTS = 10

export type RecordKind = 'project' | 'opportunity'

/**
 * The sweep's structured thread summary.
 *
 * ⚠ `email_threads.summary` IS JSONB, NOT PROSE. Checked against the live
 * schema after a first draft put the object itself into a string field and the
 * dry run printed `NaN chars`. It is the richest thing in the database for this
 * purpose: the sweep has already extracted location, sector, the people and a
 * prose summary for every thread, so most of what a curator wants is a read
 * rather than a model call (§12 — check whether the data is already on the row
 * before calling it an extraction problem).
 */
export interface ThreadSummary {
  summary?: string | null
  deal_name?: string | null
  counterparty?: string | null
  location?: string | null
  sector?: string | null
  estimated_value?: number | string | null
  /**
   * ⚠ FREE PROSE, NOT A STAGE. Measured across the linked corpus: "Due
   * Diligence", "Teaming & contract execution", "LOI signed", "meeting_
   * scheduled". `project_stage` members are pursuit/capture/bid/award/
   * mobilization/execution/closeout — none of these. Mapping one to the other
   * would be exactly the second-schema drift §12 warns about, so nothing does.
   */
  stage_signal?: string | null
  key_facts?: string[] | null
  open_items?: string[] | null
  people?: ThreadPerson[] | null
  relevance?: string | null
  confidence?: number | null
}

export interface ThreadPerson {
  name?: string | null
  title?: string | null
  company?: string | null
  email?: string | null
  role?: string | null
  is_organization?: boolean | null
}

export interface EvidenceItem {
  kind: 'email_thread' | 'text_session' | 'note' | 'recording' | 'meeting' | 'document'
  /** The row id, carried into provenance as `source_ref`. */
  ref: string
  label: string
  /** When this piece of evidence last moved. Drives the cursor. */
  at: string | null
  /** Prose, for a model call and for the evidence line on a proposal card. */
  text: string
  /** Present only for threads — the structured half the fold reads directly. */
  structured?: ThreadSummary
}

export interface RecordEvidence {
  items: EvidenceItem[]
  /** The newest `at` across everything gathered. The cursor compares on this. */
  newestAt: string | null
  /** Characters dropped by the budget, so the run can report it rather than
   *  quietly curating a deal on a third of its own correspondence. */
  truncatedItems: number
  error: string | null
}

/**
 * What to call a thread when telling a reader where a proposal came from.
 *
 * A closed mapping over `threadSource`, so a new source cannot silently become
 * "email" on a provenance line Pepper puts in front of Richard. A phone call
 * and a recorded meeting are deliberately both `recording` here — the curator's
 * reader wants to know it was SPOKEN, where `apply-phase` keeps them apart
 * because a project's feed shows the event.
 */
function evidenceKind(
  gmailThreadId: string | null | undefined,
  subject: string | null | undefined
): EvidenceItem['kind'] {
  switch (threadSource(gmailThreadId, subject)) {
    case 'imessage':
      return 'text_session'
    case 'note':
      return 'note'
    case 'call':
    case 'recording':
      return 'recording'
    case 'email':
      return 'email_thread'
  }
}

export async function gatherEvidence(args: {
  kind: RecordKind
  recordId: string
}): Promise<RecordEvidence> {
  const { kind, recordId } = args
  const parentCol = kind === 'project' ? 'project_id' : 'opportunity_id'

  const [threadLinks, meetings, documents] = await Promise.all([
    provDb()
      .from('thread_links')
      .select(
        'thread_id, updated_at, thread:email_threads(id, subject, summary, last_at, gmail_thread_id, mailbox)'
      )
      .eq('record_kind', kind)
      .eq('record_id', recordId)
      .order('updated_at', { ascending: false })
      .limit(MAX_THREADS),
    provDb()
      .from('meetings')
      .select('id, title, summary, meeting_date, updated_at, status')
      .eq(parentCol, recordId)
      .order('meeting_date', { ascending: false })
      .limit(MAX_MEETINGS),
    // ⚠ TWO TABLES, NOT ONE. `documents` has no `opportunity_id` — an
    // opportunity's files live in `opportunity_documents`, which also has no
    // `excluded_at`. §12 names this exact split: the parallel-table layout
    // means "what documents does this record have" is always TWO questions,
    // and `drive-sync`'s ownership check reading only one of them is how a
    // file already filed on an opportunity got re-claimed as company
    // knowledge. A curator reading only `documents` would simply curate every
    // opportunity as though it had no paperwork at all.
    kind === 'project'
      ? provDb()
          .from('documents')
          .select('id, file_name, ai_summary, uploaded_at, drive_modified_at')
          .eq('project_id', recordId)
          // §12: read with superseded_at is null or the graveyard reads as a
          // gap — worse than a gap here, because a retired duplicate's figures
          // would be re-proposed onto the live record.
          .is('superseded_at', null)
          .is('excluded_at', null)
          .order('uploaded_at', { ascending: false })
          .limit(MAX_DOCUMENTS)
      : provDb()
          .from('opportunity_documents')
          .select('id, file_name, ai_summary, uploaded_at, drive_modified_at')
          .eq('opportunity_id', recordId)
          .is('superseded_at', null)
          .order('uploaded_at', { ascending: false })
          .limit(MAX_DOCUMENTS),
  ])

  // ⚠ Check error on EVERY select. §12: a zero from a broken query and a zero
  // from an empty table are the same number on screen — and here an unreported
  // failure means curating a live deal against no evidence, which the model
  // would answer by proposing nothing. Indistinguishable from "nothing changed".
  const firstError =
    threadLinks.error?.message ?? meetings.error?.message ?? documents.error?.message ?? null
  if (firstError) {
    return { items: [], newestAt: null, truncatedItems: 0, error: firstError }
  }

  const items: EvidenceItem[] = []

  for (const link of (threadLinks.data ?? []) as ThreadLinkJoin[]) {
    const t = Array.isArray(link.thread) ? link.thread[0] : link.thread
    if (!t?.summary) continue
    const structured = t.summary as ThreadSummary
    // The prose half. `key_facts` is appended because the one-line summary
    // often omits the figure a reader wants, and a model call downstream has
    // to be able to quote something (§12: a quote must CONTAIN the figure).
    const prose = [
      structured.summary ?? '',
      ...(Array.isArray(structured.key_facts) ? structured.key_facts.map((f) => `- ${f}`) : []),
    ]
      .filter(Boolean)
      .join('\n')
    if (!prose.trim()) continue
    items.push({
      // ⚠ NOT `gmail_thread_id == null`, AND NOT A TWO-WAY GUESS EITHER. A
      // local thread's id is PRESENT and prefixed — `imessage:`, `note:`,
      // `voicememo:` — which is the structural discriminator every local layer
      // uses. The first draft tested for null and labelled every text message
      // as an email; the second knew about texts only, so a filed note, a
      // recorded call and now a recorded meeting were all reported to the
      // reader as email. `threadSource` answers it once (§12).
      kind: evidenceKind(t.gmail_thread_id, t.subject),
      ref: t.id,
      label: t.subject ?? '(no subject)',
      at: t.last_at ?? link.updated_at ?? null,
      text: prose,
      structured,
    })
  }

  for (const m of (meetings.data ?? []) as MeetingRowLite[]) {
    if (!m.summary) continue
    items.push({
      kind: 'meeting',
      ref: m.id,
      label: m.title ?? '(untitled call)',
      // `meeting_date` is a date, not a timestamp — compared as a string
      // against timestamptz values elsewhere it would always sort earliest, so
      // it is widened to the start of that day. Good enough for ordering and
      // for the cursor, and honest about the precision the column has.
      at: m.meeting_date ? `${m.meeting_date}T00:00:00+00:00` : (m.updated_at ?? null),
      text: m.summary,
    })
  }

  for (const d of (documents.data ?? []) as DocumentRowLite[]) {
    if (!d.ai_summary) continue
    items.push({
      kind: 'document',
      ref: d.id,
      label: d.file_name ?? '(unnamed document)',
      // ⚠ `documents` HAS NO `updated_at`. Checked against the live schema
      // rather than assumed: the columns are uploaded_at / drive_modified_at.
      // A Drive file's own modification time is the better answer when it is
      // there, because re-syncing a changed file is exactly the event the
      // curator should wake up for.
      at: d.drive_modified_at ?? d.uploaded_at ?? null,
      text: d.ai_summary,
    })
  }

  // Newest first, so the budget keeps what is current rather than what is
  // alphabetically lucky — and so the prompt reads most-recent-first, which is
  // the order that matters when two sources disagree about a date.
  items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

  const newestAt = items.length > 0 ? (items[0].at ?? null) : null

  // Fit to budget, counting what did not fit.
  const kept: EvidenceItem[] = []
  let used = 0
  let truncatedItems = 0
  for (const item of items) {
    const cost = item.text.length + item.label.length + 40
    if (used + cost > EVIDENCE_CHARS && kept.length > 0) {
      truncatedItems += 1
      continue
    }
    kept.push(item)
    used += cost
  }

  return { items: kept, newestAt, truncatedItems, error: null }
}

// ── Row shapes for the embed reads above ─────────────────────────────────────

interface ThreadLinkJoin {
  thread_id: string
  updated_at: string | null
  thread:
    | {
        id: string
        subject: string | null
        summary: ThreadSummary | null
        last_at: string | null
        gmail_thread_id: string | null
        mailbox: string | null
      }
    | Array<{
        id: string
        subject: string | null
        summary: ThreadSummary | null
        last_at: string | null
        gmail_thread_id: string | null
        mailbox: string | null
      }>
    | null
}

interface MeetingRowLite {
  id: string
  title: string | null
  summary: string | null
  /** A DATE column, not a timestamp. See where it is read. */
  meeting_date: string | null
  updated_at: string | null
  status: string | null
}

/** Shared by `documents` and `opportunity_documents` — the two tables carry
 *  the same four columns the curator needs, which is why one shape serves. */
interface DocumentRowLite {
  id: string
  file_name: string | null
  ai_summary: string | null
  uploaded_at: string | null
  drive_modified_at: string | null
}
