/**
 * APPLY — write new correspondence onto the record it belongs to.
 *
 * The last step of the chain that was missing entirely: fetch keeps threads
 * current, route says which record a thread belongs to, and this puts the new
 * messages where someone will see them.
 *
 * Two rules do most of the work here:
 *
 * 1. ONLY THE DELTA. Each link remembers how much of its thread has already
 *    been written (`applied_message_count`). Without that, every refresh would
 *    re-post the whole conversation and a project's feed would fill with the
 *    same correspondence night after night — which is how a feed stops being
 *    read at all.
 *
 * 2. CERTAINTY DECIDES REVIEW. A thread that IS the record (its lead was
 *    promoted to it, its cluster confirmed into it) posts as approved. A thread
 *    matched by name or contacts stages as pending, because an inferred link can
 *    be wrong and a wrong one would otherwise land in the record AND in Ber AI's
 *    index with nothing in between.
 *
 * CLAUDE.md §11 is intact: this updates existing records and never creates a
 * project, opportunity, party or task. An inferred update is a proposal sitting
 * in the review queue, which is exactly what that rule asks for.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { fileRecordDocumentsQuietly } from '@/lib/drive/file-document'
import { fetchThread, fetchAttachmentBytes } from '@/lib/integrations/google-workspace'
import type { TablesInsert } from '@/lib/supabase/types'
import { isOpportunityLive, isProjectLive, isSteelDealLive } from '@/lib/records/live'
import { notifyTeam, type NotificationEvent } from '@/lib/notifications'
import { broadcastEvents } from '@/lib/notifications/broadcast'
import { sweepDb, type EmailThreadRow, type ThreadLinkRow, type LinkRecordKind } from './db'

const BATCH = 100

/** PostgREST caps a response at 1000 rows and says nothing about it. */
const PAGE = 1000

/** Matches the caps used elsewhere in the sweep. */
const MAX_UPDATE_CHARS = 100_000
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_NEW_ATTACHMENTS = 10

export interface ApplyProgress {
  linksConsidered: number
  updatesPosted: number
  updatesStaged: number
  leadsTouched: number
  attachmentsImported: number
  /** Links with mail still to post, before this run's limit was applied. */
  pendingFound: number
  staleLinksDropped: number
  /** Links whose record is lost/closed/on hold — kept, but held back. */
  dormantSkipped: number
  failed: number
  /** True when the budget ran out with links still to consider. */
  outOfTime: boolean
}

/**
 * Split a rendered thread back into its messages.
 *
 * `renderThread` writes one `### <timestamp> — <sender>` heading per message and
 * is the only thing that writes this column, so the heading is a dependable
 * boundary. Deliberately not a Gmail round trip: the text is already stored, and
 * the delta is needed for every link on every grown thread.
 */
export function splitRenderedMessages(markdown: string): string[] {
  if (!markdown.trim()) return []
  const parts = markdown.split(/\n(?=### )/g)
  // The first chunk is the thread header (subject + mailbox line) unless the
  // thread somehow starts at a message.
  return parts.filter((p) => p.startsWith('### '))
}

/**
 * The messages a link has not yet carried onto its record.
 *
 * Falls back to the whole thread when the stored text cannot be split — better
 * to post a complete conversation once than to post nothing because the format
 * drifted.
 */
export function deltaFor(
  markdown: string,
  appliedCount: number,
  messageCount: number
): { text: string; newCount: number } | null {
  const messages = splitRenderedMessages(markdown)

  if (messages.length === 0) {
    if (appliedCount >= messageCount || !markdown.trim()) return null
    return { text: markdown, newCount: messageCount }
  }

  if (appliedCount >= messages.length) return null
  const fresh = messages.slice(appliedCount)
  return { text: fresh.join('\n'), newCount: messages.length }
}

type LinkWithThread = ThreadLinkRow & {
  thread: Pick<
    EmailThreadRow,
    'id' | 'subject' | 'raw_markdown' | 'message_count' | 'attachment_count' | 'mailbox' | 'gmail_thread_id' | 'last_at'
  > | null
}

export async function applyThreadUpdates(
  opts: { linkIds?: string[]; limit?: number; budgetMs?: number
    /**
     * Raise notifications for what is posted. Default true.
     *
     * Set false for a deliberate BACKLOG DRAIN: correspondence from three weeks
     * ago is not news, and announcing forty records at once teaches people to
     * ignore the bell — which is the one thing a notification channel cannot
     * recover from. Steady-state runs always announce.
     */
    announce?: boolean
  } = {}
): Promise<ApplyProgress> {
  const db = sweepDb()
  // Time-budgeted like every other phase, and for a sharper reason here: writing
  // an update is instant, but importing an attachment costs a document AI pass —
  // measured at ~30s each on the local model. One thread carrying ten drawings
  // is five minutes, so without a deadline a single unlucky batch could run for
  // hours inside an hourly cron. Commits after every link, so stopping early
  // just means the rest is picked up next run.
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const progress: ApplyProgress = {
    linksConsidered: 0,
    updatesPosted: 0,
    updatesStaged: 0,
    leadsTouched: 0,
    attachmentsImported: 0,
    pendingFound: 0,
    staleLinksDropped: 0,
    dormantSkipped: 0,
    failed: 0,
    outOfTime: false,
  }

  // ⚠ THE BATCH IS CHOSEN IN TWO STEPS, AND A ONE-STEP VERSION STARVES.
  //
  // It used to load the 100 links with the oldest last_applied_at and skip the
  // caught-up ones inside the loop — but a caught-up link is skipped WITHOUT its
  // cursor moving, so it keeps its place at the front of the order forever. The
  // same 100 links were re-read every run and everything behind them was
  // unreachable. Measured 2026-09-22: 44 links held unapplied mail, only 3 of
  // them fell inside the first 100, and the run reported `linksConsidered: 0`
  // while Myton Rail sat at 0 of 3 messages and DUBHES at 0 of 7.
  //
  // A cross-table comparison (applied_message_count < thread.message_count) is
  // not expressible in PostgREST, so the delta is computed here from a LIGHT
  // select — deliberately without raw_markdown, which is the whole body of every
  // conversation and would be tens of megabytes across the full link set.
  const candidates: Array<{ id: string; last: string | null }> = []
  for (let from = 0; ; from += PAGE) {
    let scan = db
      .from('thread_links')
      .select('id, last_applied_at, applied_message_count, thread:email_threads(message_count)')
      .order('last_applied_at', { ascending: true, nullsFirst: true })
      .range(from, from + PAGE - 1)
    if (opts.linkIds?.length) scan = scan.in('id', opts.linkIds)

    const { data: page, error: scanErr } = await scan
    if (scanErr) throw new Error(`Could not scan links to apply: ${scanErr.message}`)
    // PostgREST types a to-one embed as an array here even though it returns an
    // object, so the shape is normalised rather than asserted away.
    const rows = (page ?? []) as unknown as Array<{
      id: string
      last_applied_at: string | null
      applied_message_count: number
      thread: { message_count: number | null } | { message_count: number | null }[] | null
    }>
    for (const r of rows) {
      const thread = Array.isArray(r.thread) ? r.thread[0] : r.thread
      if (!thread) continue
      if (r.applied_message_count >= (thread.message_count ?? 0)) continue
      candidates.push({ id: r.id, last: r.last_applied_at })
    }
    // Stop as soon as the batch is full: the scan is already in the order the
    // batch wants, so the first N with a delta ARE the N that should run.
    if (rows.length < PAGE || candidates.length >= (opts.limit ?? BATCH)) break
  }

  progress.pendingFound = candidates.length
  const take = candidates.slice(0, opts.limit ?? BATCH).map((c) => c.id)
  if (take.length === 0) return progress

  const { data, error } = await db
    .from('thread_links')
    .select(
      '*, thread:email_threads(id, subject, raw_markdown, message_count, attachment_count, mailbox, gmail_thread_id, last_at)'
    )
    .in('id', take)
    .order('last_applied_at', { ascending: true, nullsFirst: true })
  if (error) throw new Error(`Could not load links to apply: ${error.message}`)

  // Collected across the run and sent once at the end, for the same reason the
  // document notifications batch: a sweep that files correspondence onto six
  // records should be one round of notifications, not six.
  const events: NotificationEvent[] = []

  for (const raw of (data ?? []) as LinkWithThread[]) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }
    const link = raw
    const thread = link.thread
    if (!thread) continue

    // Nothing new on this thread — the common case, and it must stay cheap.
    if (link.applied_message_count >= (thread.message_count ?? 0)) continue

    progress.linksConsidered++

    try {
      const delta = deltaFor(
        thread.raw_markdown ?? '',
        link.applied_message_count,
        thread.message_count ?? 0
      )
      if (!delta) {
        await advance(link.id, thread.message_count ?? 0)
        continue
      }

      const applied = await applyToRecord(link, thread, delta.text, progress, events)
      if (applied === 'missing') {
        // The record has gone. The link points at four possible tables so it
        // cannot carry a foreign key; dropping it here is what takes the place
        // of the cascade it never had.
        await db.from('thread_links').delete().eq('id', link.id)
        progress.staleLinksDropped++
        continue
      }

      if (applied === 'dormant') {
        // Lost, closed, on hold. The LINK is kept and applied_message_count is
        // deliberately NOT advanced, so reviving the record replays everything
        // it missed — mail that arrives while a pursuit is parked is usually
        // why it gets un-parked.
        //
        // last_applied_at IS stamped, though. The batch is ordered by it with
        // nulls first, so without this a dormant link would sort to the front
        // of every run forever and starve the live records behind it.
        await touch(link.id)
        progress.dormantSkipped++
        continue
      }

      if (applied === 'ok' && (thread.attachment_count ?? 0) > 0) {
        progress.attachmentsImported += await importNewAttachments(link, thread)
      }

      await advance(link.id, delta.newCount)
    } catch (err) {
      progress.failed++
      console.error(
        `[sweep/apply] link ${link.id} failed:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Both helpers swallow their own failures — a Chat outage or a missing
  // notifications table must never cost correspondence that is already filed.
  if (events.length > 0 && opts.announce !== false) {
    await notifyTeam(events)
    await broadcastEvents(events)
  }

  return progress
}

/**
 * Rotate a link to the back of the queue without crediting it any messages.
 *
 * Used for a dormant record: it has not received this mail and must not be
 * recorded as having done so, but it also must not block the batch.
 */
async function touch(linkId: string): Promise<void> {
  const { error } = await sweepDb()
    .from('thread_links')
    .update({ last_applied_at: new Date().toISOString() })
    .eq('id', linkId)
  if (error) console.error(`[sweep/apply] could not touch ${linkId}:`, error.message)
}

async function advance(linkId: string, count: number): Promise<void> {
  const { error } = await sweepDb()
    .from('thread_links')
    .update({ applied_message_count: count, last_applied_at: new Date().toISOString() })
    .eq('id', linkId)
  if (error) console.error(`[sweep/apply] could not advance ${linkId}:`, error.message)
}

/**
 * Lines that carry no information to someone glancing at a notification.
 *
 * Two sources, both at the TOP of a delta and both mattering: renderThread's own
 * `### timestamp — sender` / `To:` heading, and the header block an Outlook or
 * Gmail forward pastes into the body. Without this the notification leads with
 * "### 2026-09-07 16:05 — BER WILSON COMPANY <info@…> To: From: …" and the
 * reader learns nothing — which is exactly what it did on the first live run.
 */
const HEADER_LINE =
  /^(###\s|To:|From:|Cc:|CC:|Bcc:|Sent:|Date:|Subject:|-{2,}\s*(Original|Forwarded)|_{3,})/i

/**
 * The first line of real prose in a message body.
 *
 * Bounded at MAX_HEADER_SKIP so a message that genuinely is nothing but headers
 * still shows something rather than coming back empty.
 */
function firstProse(body: string): string {
  const lines = body.split('\n')
  let i = 0
  const limit = Math.min(lines.length, MAX_HEADER_SKIP)
  while (i < limit && (!lines[i].trim() || HEADER_LINE.test(lines[i].trim()))) i++
  const rest = lines.slice(i).join(' ').replace(/\s+/g, ' ').trim()
  return rest || body.replace(/\s+/g, ' ').trim()
}

const MAX_HEADER_SKIP = 12

/**
 * One "new correspondence" notification.
 *
 * The subject is the headline because it is what a person recognises the
 * conversation by; the snippet under it is the first line or two of what is
 * actually new, which is the difference between a notification worth opening
 * and a bare "something happened".
 *
 * No actorName/actorEmail: the platform read this mail, so there is nobody to
 * exclude and everybody is told — which is the right default for a record whose
 * counterparty just said something.
 */
function correspondenceEvent(
  recordName: string | null | undefined,
  subject: string,
  body: string,
  href: string,
  projectId: string | null
): NotificationEvent {
  const snippet = firstProse(body).slice(0, 220)
  return {
    kind: 'correspondence',
    title: `${recordName?.trim() || 'A record'} — new correspondence`,
    body: [subject, snippet].filter(Boolean).join(' · '),
    href,
    projectId,
  }
}

type ApplyOutcome = 'ok' | 'missing' | 'skipped' | 'dormant'

async function applyToRecord(
  link: ThreadLinkRow,
  thread: NonNullable<LinkWithThread['thread']>,
  text: string,
  progress: ApplyProgress,
  events: NotificationEvent[]
): Promise<ApplyOutcome> {
  const supabase = createAdminClient()
  const body = text.slice(0, MAX_UPDATE_CHARS)
  const label = thread.subject?.trim() || 'Email thread'
  // Certainty, not content, decides whether a human sees this first.
  const approved = link.certainty === 'linked'

  switch (link.record_kind) {
    case 'project': {
      const { data: project } = await supabase
        .from('projects')
        .select('id, name, status')
        .eq('id', link.record_id)
        .maybeSingle()
      if (!project) return 'missing'
      if (!isProjectLive(project.status)) return 'dormant'

      const row: TablesInsert<'updates'> = {
        project_id: link.record_id,
        source: 'email',
        // The Gmail thread id, so an update can be traced back to the
        // conversation it came from.
        source_ref: thread.gmail_thread_id,
        raw_content: body,
        summary: `Email — ${label}`,
        review_state: approved ? 'approved' : 'pending',
      }
      const { data: update, error } = await supabase
        .from('updates')
        .insert(row)
        .select('id')
        .single()
      if (error || !update) throw new Error(error?.message ?? 'update insert failed')

      // ⚠ DELIBERATELY NOT EMBEDDED INTO `chunks`, and this reverses an
      // earlier call. The mail is already indexed — `thread_chunks` holds the
      // whole correspondence corpus and is what `search_correspondence` reads
      // — so embedding the same body here indexed it a second time, in the
      // CURATED index, which is precisely the pollution the separate table was
      // created on 2026-09-14 to prevent.
      //
      // Measured 2026-09-21 on a real question ("Sandpoint cottage permit set
      // and lateral takeoff for 15 homes"): the top three hits in `chunks`
      // were all email chrome — a URL tracking token at 0.740, a signature
      // block at 0.697, a message header at 0.673 — and the Sandpoint content
      // itself did not appear in the top eight. Raw mail carries headers,
      // signatures and tracking URLs that a curated document does not, and
      // those score well against anything.
      //
      // Nothing is lost: the agent already queries both indexes, and
      // `get_record_correspondence` / `get_record_brief` read filed mail
      // directly rather than through vector search.
      if (approved) {
        progress.updatesPosted++
        events.push(
          correspondenceEvent(
            (project as { name?: string | null }).name,
            label,
            body,
            `/projects/${link.record_id}/updates`,
            link.record_id
          )
        )
      } else {
        // A pending review_state is NOT what /review reads — that page is driven
        // by review_queue. Without this row the update would sit pending forever
        // with nothing anywhere surfacing it, which is the "wired a feature that
        // renders nowhere" failure this codebase has hit before.
        const { error: queueErr } = await supabase.from('review_queue').insert({
          source_table: 'updates',
          record_id: update.id,
          project_id: link.record_id,
          reason: 'inferred_email_match',
          confidence: link.confidence,
          ai_explanation: `Matched to this project by ${link.reason ?? 'inference'}. Approve to post it and index it, or reject to unlink the conversation from this project.`,
        })
        if (queueErr) console.error('[sweep/apply] could not queue for review:', queueErr.message)
        progress.updatesStaged++
      }
      return 'ok'
    }

    case 'opportunity': {
      const { data: opportunity } = await supabase
        .from('opportunities')
        .select('id, name, status')
        .eq('id', link.record_id)
        .maybeSingle()
      if (!opportunity) return 'missing'
      if (!isOpportunityLive(opportunity.status)) return 'dormant'

      // Opportunity notes have no review state, so an inferred match says so in
      // the note itself rather than pretending to a certainty it does not have.
      const prefix = approved ? '' : `[Unconfirmed match — ${link.reason ?? 'inferred'}]\n\n`
      const { data: note, error } = await supabase
        .from('opportunity_notes')
        .insert({
          opportunity_id: link.record_id,
          body: `${prefix}Email — ${label}\n\n${body}`,
          author: 'Ber AI',
        })
        .select('id')
        .single()
      if (error || !note) throw new Error(error?.message ?? 'note insert failed')

      // Not embedded, for the same reason as the project branch above: this
      // body is mail, and mail is already indexed in `thread_chunks`.
      if (approved) {
        progress.updatesPosted++
        events.push(
          correspondenceEvent(
            (opportunity as { name?: string | null }).name,
            label,
            body,
            `/opportunities/${link.record_id}`,
            null
          )
        )
      } else progress.updatesStaged++
      return 'ok'
    }

    case 'steel_deal': {
      const { data: deal } = await sweepDb()
        .from('steel_deals')
        .select('id, stage')
        .eq('id', link.record_id)
        .maybeSingle()
      if (!deal) return 'missing'
      if (!isSteelDealLive(deal.stage as string | null)) return 'dormant'

      const prefix = approved ? '' : `[Unconfirmed match — ${link.reason ?? 'inferred'}]\n\n`
      const { error } = await sweepDb()
        .from('steel_deal_notes')
        .insert({
          deal_id: link.record_id,
          body: `${prefix}Email — ${label}\n\n${body}`,
          author: 'Ber AI',
        })
      if (error) throw new Error(error.message)
      if (approved) progress.updatesPosted++
      else progress.updatesStaged++
      return 'ok'
    }

    case 'lead': {
      const db = sweepDb()
      const { data: lead } = await db
        .from('leads')
        .select('id, status')
        .eq('id', link.record_id)
        .maybeSingle()
      if (!lead) return 'missing'

      const row = lead as { id: string; status: string }
      // A promoted or forwarded lead has moved on; its later mail belongs to the
      // record it became, which routing links separately.
      if (row.status === 'promoted' || row.status === 'forwarded') return 'skipped'

      const { error } = await db.from('lead_notes').insert({
        lead_id: link.record_id,
        body: `New email on this thread — ${label}\n\n${body.slice(0, 10_000)}`,
        author: 'Ber AI',
      })
      if (error) throw new Error(error.message)

      // Re-SCORE it: the fit assessment was formed from a shorter conversation
      // than the one that now exists. (Its facts — bid date, scope, value — are
      // re-read separately: the fetch refresh puts a grown thread back to
      // summary_state='pending', which is what re-runs triage.)
      //
      // An expired lead is deliberately reopened: mail arriving on a lead that
      // timed out usually means the date moved.
      await db
        .from('leads')
        .update({
          score_state: 'pending',
          status: row.status === 'expired' ? 'new' : row.status,
        })
        .eq('id', link.record_id)

      progress.leadsTouched++
      return 'ok'
    }
  }
}

/**
 * Copy files that arrived on the new messages onto the record.
 *
 * Bounded and best-effort: promotion already carries a lead's evidence across,
 * so this is about the drawing that turns up in reply eleven, and a failure here
 * must never cost the correspondence that came with it.
 */
async function importNewAttachments(
  link: ThreadLinkRow,
  thread: NonNullable<LinkWithThread['thread']>
): Promise<number> {
  if (link.record_kind !== 'project' && link.record_kind !== 'opportunity') return 0

  try {
    const messages = await fetchThread(thread.mailbox, thread.gmail_thread_id)
    const fresh = messages.slice(link.applied_message_count)

    // Dedupe on FILE NAME, not name+size. A bid package resends the same
    // drawing on every reply, and — measured on this corpus — the same document
    // sent from two different threads arrives at different byte sizes, re-encoded
    // or lightly revised: one briefing came in at 205,839 and 211,664 bytes, and
    // a Myton memo at 134,676 and 134,980. Keying on size let both through.
    //
    // The trade-off is deliberate. A genuinely different file that happens to
    // share a name with one already on the record will be skipped, and it stays
    // in the email where it can still be found. That is the cheaper error: a
    // near-duplicate doubles the document's chunks and biases every retrieval
    // toward whatever was duplicated, which degrades the answers this whole
    // feature exists to improve.
    const seen = new Set<string>()
    const refs = fresh
      .flatMap((m) => m.attachments)
      .filter((a) => {
        if (a.isInline || a.size <= 0 || a.size > MAX_ATTACHMENT_BYTES) return false
        const key = a.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_NEW_ATTACHMENTS)
    if (refs.length === 0) return 0

    const supabase = createAdminClient()
    const isProject = link.record_kind === 'project'
    const folder = isProject ? 'projects' : 'opportunities'
    // What the record already holds, so a file that arrived on one thread is not
    // imported again from another. Several threads about the same deal routinely
    // carry the same attachment, and a duplicate is not merely untidy: it doubles
    // the document's chunks and biases retrieval toward whatever was duplicated.
    //
    // Branched rather than parameterised by table name — a union of table names
    // loses the column types the typed client checks against.
    const { data: existingDocs } = isProject
      ? await supabase.from('documents').select('file_name').eq('project_id', link.record_id)
      : await supabase
          .from('opportunity_documents')
          .select('file_name')
          .eq('opportunity_id', link.record_id)

    const already = new Set(
      ((existingDocs ?? []) as { file_name: string | null }[]).map((d) =>
        (d.file_name ?? '').toLowerCase()
      )
    )

    let imported = 0

    for (const ref of refs) {
      if (already.has(ref.name.toLowerCase())) continue
      already.add(ref.name.toLowerCase())
      const base64 = await fetchAttachmentBytes(thread.mailbox, ref.messageId, ref.attachmentId)
      if (!base64) continue
      const buffer = Buffer.from(base64, 'base64')
      const safe = ref.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
      const path = `${folder}/${link.record_id}/${Date.now()}-${safe}`

      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, buffer, { contentType: ref.mimeType || 'application/octet-stream' })
      if (upErr) {
        console.error(`[sweep/apply] could not upload ${ref.name}:`, upErr.message)
        continue
      }

      if (isProject) {
        const { data: doc, error } = await supabase
          .from('documents')
          .insert({
            project_id: link.record_id,
            file_name: ref.name,
            storage_path: path,
            mime_type: ref.mimeType || null,
            file_size_bytes: ref.size,
            doc_type: 'correspondence',
            source: 'document',
          } as never)
          .select('id')
          .single()
        if (error || !doc) {
          console.error(`[sweep/apply] could not register ${ref.name}:`, error?.message)
          continue
        }
        imported++
        // Settles embedding_status itself and never throws.
        await runDocumentAiPass({
          supabase,
          documentId: (doc as { id: string }).id,
          projectId: link.record_id,
          fileName: ref.name,
          mimeType: ref.mimeType || null,
          buffer: buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer,
        })
      } else {
        const { data: doc, error } = await supabase
          .from('opportunity_documents')
          .insert({
            opportunity_id: link.record_id,
            file_name: ref.name,
            storage_path: path,
            mime_type: ref.mimeType || null,
            file_size_bytes: ref.size,
            doc_type: 'correspondence',
          } as never)
          .select('id')
          .single()
        if (error || !doc) {
          console.error(`[sweep/apply] could not register ${ref.name}:`, error?.message)
          continue
        }
        imported++
        // An opportunity attachment used to get no summary, no extracted text
        // and no embedding -- the project branch ran the pass and this one just
        // inserted and stopped. So the M&A material, which is exactly where the
        // dense documents arrive, was invisible to Ber AI and left the folder
        // classifier judging on a file name alone.
        await runDocumentAiPass({
          supabase,
          documentId: (doc as { id: string }).id,
          projectId: null,
          fileName: ref.name,
          mimeType: ref.mimeType || null,
          buffer: buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer,
          target: { table: 'opportunity_documents', opportunityId: link.record_id },
        })
      }
    }

    // Filing runs after the loop so the AI summaries exist to classify on, and
    // once per record rather than once per file. Best-effort by construction: a
    // Drive outage must never fail an attachment import that already succeeded.
    if (imported > 0) {
      await fileRecordDocumentsQuietly(supabase, isProject ? 'project' : 'opportunity', link.record_id)
    }

    return imported
  } catch (err) {
    console.error(
      `[sweep/apply] attachments for ${thread.gmail_thread_id} failed:`,
      err instanceof Error ? err.message : String(err)
    )
    return 0
  }
}

/** Record kinds this phase knows how to write to. */
export const APPLIABLE_KINDS: LinkRecordKind[] = ['project', 'opportunity', 'steel_deal', 'lead']
