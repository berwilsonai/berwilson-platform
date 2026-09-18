/**
 * The correspondence index — making swept email answerable by meaning.
 *
 * The gap this fills, measured against live data before it existed: asking
 * "what are the details on the Hill AFB site visit?" reached almost nothing,
 * because `search_email_threads` keyword-matches subject, deal_name,
 * counterparty, summary and key_facts and NEVER the message body. 15 threads
 * mentioned Hill AFB in their text; 5 in their subject; 2 in their AI summary.
 * The answer — "The sit visit is September 15 @ 9:00 am" — was sitting in plain
 * text that nothing could retrieve.
 *
 * Deliberately writes to `thread_chunks`, never `chunks`. See the migration for
 * the full argument; the short version is that match_chunks with no project
 * filter returns its whole table, so email in `chunks` would leak into every
 * curated CRM answer, and email would outnumber curated content 3.7 to 1.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { chunkText, generateEmbedding } from './embeddings'
import { dedupeByContent, DEDUPE_OVERFETCH } from './dedupe'
import { documentKind } from './document-pipeline'
import { extractDocxText, transcribePdfText } from './document-text'
import { fetchThread, fetchAttachmentBytes } from '@/lib/integrations/google-workspace'
import { sweepDb, type EmailThreadRow } from '@/lib/email-sweep/db'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

/** Cap per thread. A long reply chain is repetitive; the tail adds little. */
const MAX_BODY_CHARS = 120_000
/** Cap per attachment's extracted text. */
const MAX_ATTACHMENT_CHARS = 200_000
/** Skip files too big to be worth the download on a local box. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
/** Attachments read per thread. A bid package resends drawings on every reply. */
const MAX_ATTACHMENTS = 8

export interface EmbedThreadResult {
  threadId: string
  bodyChunks: number
  attachmentChunks: number
  attachmentsRead: number
  skipped: boolean
  reason?: string
}

/**
 * Documents a thread REFERS to but the platform does not hold.
 *
 * This is what keeps an answer honest. Bid invitations routinely carry the real
 * terms — registration, bonding, licensing — in a file behind a portal login:
 * BuildingConnected sends `app.buildingconnected.com/goto/…` links, not
 * attachments. Verified on the Hill AFB threads, which have a combined
 * attachment count of ZERO while naming five documents in their text.
 *
 * Without this, "do we need to register?" would be answered from silence, and
 * silence reads identically to "no requirement". With it, the answer can name
 * the document and where it lives.
 */
export interface PortalReference {
  /** The file the link is for. Links with no nearby filename are discarded. */
  fileName: string
  /** Human name of the system holding it, e.g. "BuildingConnected". */
  host: string
  url: string
}

const PORTAL_HOSTS: Array<{ match: RegExp; label: string }> = [
  { match: /buildingconnected\.com/i, label: 'BuildingConnected' },
  { match: /procore\.com/i, label: 'Procore' },
  { match: /smartbidnet\.com|smartbid\.co/i, label: 'SmartBid' },
  { match: /isqft\.com/i, label: 'iSqFt' },
  { match: /planhub\.com/i, label: 'PlanHub' },
  { match: /bidmail\.com/i, label: 'BidMail' },
  { match: /sharepoint\.com/i, label: 'SharePoint' },
  { match: /dropbox\.com/i, label: 'Dropbox' },
  { match: /box\.com/i, label: 'Box' },
  { match: /bidnetdirect\.com/i, label: 'BidNet Direct' },
  { match: /drive\.google\.com/i, label: 'Google Drive' },
]

const FILE_NAME_RE = /([A-Za-z0-9][\w .,+\-()]{2,80}\.(?:pdf|docx?|xlsx?|zip|dwg|rvt|pptx?))/i

/**
 * Find portal links, pairing each with the filename that precedes it.
 *
 * Mail from these systems lists a filename on one line and its link on the
 * next, so the nearest preceding filename is the right association — matched on
 * a window rather than the whole document so a long list does not attribute
 * every link to its first file.
 */
export function extractPortalLinks(markdown: string): PortalReference[] {
  if (!markdown) return []
  const out: PortalReference[] = []
  const seen = new Set<string>()

  const urlRe = /https?:\/\/[^\s)<>"']+/g
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(markdown)) !== null) {
    const url = m[0]
    const host = PORTAL_HOSTS.find((h) => h.match.test(url))
    if (!host) continue

    // Look back a short window for the file this link belongs to.
    const window = markdown.slice(Math.max(0, m.index - 300), m.index)
    const nameMatch = window.match(new RegExp(FILE_NAME_RE.source + '(?![\\s\\S]*' + FILE_NAME_RE.source + ')', 'i'))
    const fileName = nameMatch ? nameMatch[1].trim() : null

    // A link with no filename near it is not a document reference — in
    // BuildingConnected mail those are the per-trade "Reply to" buttons (Metal
    // Framing, Ceramic Tile, …), which outnumbered the real documents 8 to 5 on
    // the thread this was built against. Listing them would bury the one file
    // that actually answers the question.
    if (!fileName) continue

    // One entry per file per host — these links repeat once per trade package.
    const key = `${host.label}:${fileName}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ fileName, host: host.label, url })
  }

  return out
}

type ThreadForEmbed = Pick<
  EmailThreadRow,
  'id' | 'subject' | 'raw_markdown' | 'mailbox' | 'gmail_thread_id' | 'attachment_count' | 'summary'
>

/**
 * Index one thread: its text, and the text of any files it carries.
 *
 * Delete-and-replace, so a re-embed after the conversation grows cannot leave
 * both versions in the index contradicting each other.
 */
export async function embedThread(
  thread: ThreadForEmbed,
  opts: { includeAttachments?: boolean } = {}
): Promise<EmbedThreadResult> {
  const db = sweepDb()
  const result: EmbedThreadResult = {
    threadId: thread.id,
    bodyChunks: 0,
    attachmentChunks: 0,
    attachmentsRead: 0,
    skipped: false,
  }

  const body = (thread.raw_markdown ?? '').slice(0, MAX_BODY_CHARS)
  if (!body.trim()) {
    // Stamped anyway: a thread with no readable text will never become
    // embeddable, and leaving embedded_at null would re-select it every run.
    await markEmbedded(thread.id)
    return { ...result, skipped: true, reason: 'no readable text' }
  }

  await db.from('thread_chunks').delete().eq('thread_id', thread.id)

  const rows: Array<Record<string, unknown>> = []

  for (const chunk of chunkText(body)) {
    const embedding = await generateEmbedding(chunk.content)
    rows.push({
      thread_id: thread.id,
      source: 'body',
      attachment_name: null,
      content: chunk.content,
      chunk_index: chunk.chunkIndex,
      token_count: chunk.tokenCount,
      embedding: JSON.stringify(embedding),
    })
  }
  result.bodyChunks = rows.length

  if (opts.includeAttachments !== false && (thread.attachment_count ?? 0) > 0) {
    const attachments = await readAttachmentText(thread)
    result.attachmentsRead = attachments.length
    for (const file of attachments) {
      for (const chunk of chunkText(file.text.slice(0, MAX_ATTACHMENT_CHARS))) {
        const embedding = await generateEmbedding(chunk.content)
        rows.push({
          thread_id: thread.id,
          source: 'attachment',
          attachment_name: file.name,
          content: chunk.content,
          chunk_index: chunk.chunkIndex,
          token_count: chunk.tokenCount,
          embedding: JSON.stringify(embedding),
        })
        result.attachmentChunks++
      }
    }
  }

  // Inserted in batches: a bid package can produce hundreds of chunks, and one
  // statement per chunk is needless round trips.
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await db.from('thread_chunks').insert(rows.slice(i, i + 50))
    if (error) throw new Error(`thread_chunks insert failed: ${error.message}`)
  }

  await markEmbedded(thread.id)
  return result
}

async function markEmbedded(threadId: string): Promise<void> {
  const { error } = await sweepDb()
    .from('email_threads')
    .update({ embedded_at: new Date().toISOString() })
    .eq('id', threadId)
  if (error) console.error(`[thread-embed] could not stamp ${threadId}:`, error.message)
}

/**
 * Pull the text out of a thread's attachments.
 *
 * Deliberately does NOT call runDocumentAiPass. That runs a summarization call
 * per file — measured at ~48s on the local model — and search needs the
 * verbatim text, not a summary. Skipping it is what makes indexing attachments
 * affordable rather than an overnight job.
 *
 * Never throws: a thread whose files cannot be read is still worth having its
 * body indexed.
 */
async function readAttachmentText(
  thread: ThreadForEmbed
): Promise<Array<{ name: string; text: string }>> {
  const out: Array<{ name: string; text: string }> = []
  try {
    const messages = await fetchThread(thread.mailbox, thread.gmail_thread_id)

    // Dedupe by name: the same drawing is resent on every reply, and the same
    // document can arrive at slightly different byte sizes when re-encoded.
    const seen = new Set<string>()
    const refs = messages
      .flatMap((m) => m.attachments)
      .filter((a) => {
        if (a.isInline || a.size <= 0 || a.size > MAX_ATTACHMENT_BYTES) return false
        if (documentKind(a.mimeType, a.name) === 'unsupported') return false
        const key = a.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_ATTACHMENTS)

    for (const ref of refs) {
      try {
        const base64 = await fetchAttachmentBytes(thread.mailbox, ref.messageId, ref.attachmentId)
        if (!base64) continue
        const buffer = Buffer.from(base64, 'base64')
        const kind = documentKind(ref.mimeType, ref.name)

        let text: string | null = null
        if (kind === 'pdf') {
          text = await transcribePdfText({
            dataBase64: base64,
            byteLength: buffer.byteLength,
            fileName: ref.name,
            userId: SYSTEM_USER_ID,
          })
        } else if (kind === 'docx') {
          text = await extractDocxText(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
          )
        } else if (kind === 'text') {
          text = buffer.toString('utf8')
        }

        if (text?.trim()) out.push({ name: ref.name, text: text.trim() })
      } catch (err) {
        console.error(
          `[thread-embed] attachment ${ref.name} failed:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  } catch (err) {
    console.error(
      `[thread-embed] could not read attachments for ${thread.gmail_thread_id}:`,
      err instanceof Error ? err.message : String(err)
    )
  }
  return out
}

export interface EmbedProgress {
  processed: number
  bodyChunks: number
  attachmentChunks: number
  skipped: number
  failed: number
  remaining: number
  outOfTime: boolean
}

/**
 * Index threads that have not been indexed yet, newest first.
 *
 * Marketing is excluded, but the two pipelines say so in DIFFERENT PLACES and
 * getting that wrong silently drops the mail most worth asking about:
 *
 *   deal threads  — carry an AI summary with a `relevance` label; 'noise' is
 *                   newsletters and bid-board digests, which name dozens of
 *                   unrelated projects and would match falsely against all of
 *                   them.
 *   lead threads  — have NO summary at all (the lead pipeline triages into the
 *                   `leads` table instead), so `summary->>relevance` is null for
 *                   every one of them. A `.neq(...,'noise')` filter drops nulls,
 *                   which would have excluded all 992 lead threads — including
 *                   the Hill AFB bid invitations this feature was built for.
 *                   Their marketing verdict lives in `leads.status = 'spam'`.
 *
 * So: index a thread unless it is deal-noise or its lead was rejected as spam.
 */
export async function embedPendingThreads(
  opts: { budgetMs?: number; limit?: number; includeAttachments?: boolean } = {}
): Promise<EmbedProgress> {
  const db = sweepDb()
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const batch = opts.limit ?? 50

  const progress: EmbedProgress = {
    processed: 0,
    bodyChunks: 0,
    attachmentChunks: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    outOfTime: false,
  }

  for (;;) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    const { data, error } = await db
      .from('email_threads')
      .select('id, subject, raw_markdown, mailbox, gmail_thread_id, attachment_count, summary, pipeline')
      .eq('summary_state', 'summarized')
      .is('embedded_at', null)
      // Deal-side noise only. Lead-side exclusion happens below, because it
      // lives in a different table.
      .or('summary->>relevance.is.null,summary->>relevance.neq.noise')
      .order('last_at', { ascending: false })
      .limit(batch)

    if (error) throw new Error(`Could not load threads to embed: ${error.message}`)
    const candidates = (data ?? []) as Array<ThreadForEmbed & { pipeline?: string }>
    if (candidates.length === 0) break

    // Spam-filtered threads are stamped inside, so they are counted HERE or the
    // run reports "0 skipped" while silently passing over hundreds of threads —
    // a count that disagrees with reality is worse than no count.
    const { keep: rows, dropped } = await withoutSpamLeads(candidates)
    progress.skipped += dropped
    if (rows.length === 0) continue

    for (const row of rows) {
      if (Date.now() >= deadline) {
        progress.outOfTime = true
        break
      }
      try {
        const r = await embedThread(row, { includeAttachments: opts.includeAttachments })
        progress.bodyChunks += r.bodyChunks
        progress.attachmentChunks += r.attachmentChunks
        if (r.skipped) progress.skipped++
      } catch (err) {
        progress.failed++
        console.error(
          `[thread-embed] thread ${row.id} failed:`,
          err instanceof Error ? err.message : String(err)
        )
        // Stamp it so one poisonous thread cannot block the queue forever; the
        // backfill can clear embedded_at to retry deliberately.
        await markEmbedded(row.id)
      }
      progress.processed++
    }
  }

  const { count } = await db
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('summary_state', 'summarized')
    .is('embedded_at', null)
    .or('summary->>relevance.is.null,summary->>relevance.neq.noise')
  progress.remaining = count ?? 0

  return progress
}

/**
 * Drop threads whose lead was triaged as marketing, and stamp them so they are
 * not reconsidered every run.
 *
 * A lead thread with no lead row at all is KEPT: it may simply not have been
 * triaged yet, and silently dropping mail because a different pipeline has not
 * caught up would be the same class of invisible loss this filter exists to
 * avoid.
 */
async function withoutSpamLeads<T extends { id: string }>(
  rows: T[]
): Promise<{ keep: T[]; dropped: number }> {
  if (rows.length === 0) return { keep: rows, dropped: 0 }
  const db = sweepDb()
  const spam = new Set<string>()

  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id)
    const { data } = await db
      .from('leads')
      .select('thread_id, status')
      .in('thread_id', ids)
      .eq('status', 'spam')
    for (const raw of data ?? []) spam.add(String((raw as { thread_id: string }).thread_id))
  }

  // A thread can carry several leads (one email describing several deals); keep
  // it if ANY of them is real, so only wholly-marketing mail is excluded.
  if (spam.size > 0) {
    const ids = [...spam]
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await db
        .from('leads')
        .select('thread_id')
        .in('thread_id', ids.slice(i, i + 100))
        .neq('status', 'spam')
      for (const raw of data ?? []) spam.delete(String((raw as { thread_id: string }).thread_id))
    }
  }

  const keep: T[] = []
  let dropped = 0
  for (const row of rows) {
    if (spam.has(row.id)) {
      await markEmbedded(row.id)
      dropped++
    } else keep.push(row)
  }
  return { keep, dropped }
}

/** Retrieval over the correspondence index. */
export interface CorrespondenceHit {
  threadId: string
  subject: string | null
  mailbox: string | null
  gmailThreadId: string | null
  participants: string[]
  lastAt: string | null
  source: 'body' | 'attachment'
  attachmentName: string | null
  content: string
  similarity: number
}

export async function searchCorrespondence(
  query: string,
  opts: { limit?: number; sinceDays?: number; mailbox?: string } = {}
): Promise<CorrespondenceHit[]> {
  const embedding = await generateEmbedding(query)
  const filterAfter =
    opts.sinceDays && opts.sinceDays > 0
      ? new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString()
      : null

  // Over-fetch so duplicate passages can be collapsed without costing the
  // caller results: a quoted reply chain repeats its parent message in every
  // subsequent mail, and 17% of this table is exactly-duplicated text.
  const limit = opts.limit ?? 12
  const { data, error } = await createAdminClient().rpc('match_thread_chunks' as never, {
    query_embedding: JSON.stringify(embedding),
    match_count: limit * DEDUPE_OVERFETCH,
    filter_after: filterAfter,
    filter_mailbox: opts.mailbox ?? null,
  } as never)

  if (error) throw new Error(`Correspondence search failed: ${error.message}`)

  const hits = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    threadId: String(r.thread_id),
    subject: (r.subject as string) ?? null,
    mailbox: (r.mailbox as string) ?? null,
    gmailThreadId: (r.gmail_thread_id as string) ?? null,
    participants: (r.participants as string[]) ?? [],
    lastAt: (r.last_at as string) ?? null,
    source: (r.source as 'body' | 'attachment') ?? 'body',
    attachmentName: (r.attachment_name as string) ?? null,
    content: String(r.content ?? ''),
    similarity: Number(r.similarity ?? 0),
  }))

  return dedupeByContent(hits, (h) => h.content, limit)
}
