/**
 * Retire the duplicate index on documents whose text is already in the mail.
 *
 * `readAttachmentText` has been indexing every pdf/docx/text email attachment
 * into `thread_chunks` since it was built; the attachment import then chunked
 * the same bytes AGAIN into `chunks`. Measured 2026-10-15: 63 of 89 live
 * correspondence documents, 1,074 of their 1,352 chunks, the same passages in
 * two corpora and two tools able to quote each of them.
 *
 * The import no longer does this (`skipEmbed` + `reconcileMailIndexedDocuments`).
 * This clears what accumulated before it.
 *
 * READS BEFORE IT WRITES, and refuses to guess:
 *
 *  - A document is only touched if `thread_chunks` can be shown to hold its
 *    text. Its own chunks are deleted on that evidence and nothing else.
 *  - The old rows carry no `source_thread_id`, so the thread is resolved
 *    through the record's own `thread_links` — and only when EXACTLY ONE of
 *    them carries an attachment of that name. Two candidates is ambiguity, and
 *    ambiguity means no match (§12): those rows are left fully indexed and
 *    counted, because a duplicate passage costs little and a wrong
 *    `source_thread_id` would point the reconcile pass at the wrong thread
 *    forever.
 *
 * Idempotent. Run it twice; the second run must report nothing.
 *
 *   export PATH="$HOME/.node/bin:$PATH"
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *     --env-file=.env.local scripts/one-shot/dedupe-mail-indexed-documents.mts --dry
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { INDEXED_IN_MAIL } from '@/lib/documents/status'

const DRY = process.argv.includes('--dry')
const supabase = createAdminClient()

type Side = 'project' | 'opportunity'

interface Candidate {
  id: string
  fileName: string
  side: Side
  recordId: string
  chunks: number
  /** Characters of text its own chunks hold, for the coverage guard. */
  ownChars: number
  threadId: string | null
  /** Why it was passed over, when it was. */
  skipped: string | null
}

// ---------------------------------------------------------------------------
// 1. The documents that came off a thread and still hold chunks of their own
// ---------------------------------------------------------------------------

const [projectRes, oppRes] = await Promise.all([
  supabase
    .from('documents')
    .select('id, file_name, project_id, embedding_status, source_thread_id')
    .eq('doc_type', 'correspondence')
    .not('project_id', 'is', null)
    .is('superseded_at', null)
    .is('excluded_at', null),
  supabase
    .from('opportunity_documents')
    .select('id, file_name, opportunity_id, embedding_status, source_thread_id')
    .eq('doc_type', 'correspondence')
    .is('superseded_at', null)
    .is('excluded_at', null),
])

for (const [label, res] of [
  ['documents', projectRes],
  ['opportunity_documents', oppRes],
] as const) {
  // A PostgREST error read as an empty result is how a filing audit ran green
  // over 103 documents it never looked at. Fail loudly instead.
  if (res.error) throw new Error(`could not read ${label}: ${res.error.message}`)
}

const candidates: Candidate[] = [
  ...((projectRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    fileName: (r.file_name as string) ?? '',
    side: 'project' as Side,
    recordId: r.project_id as string,
    chunks: 0,
    ownChars: 0,
    threadId: (r.source_thread_id as string | null) ?? null,
    skipped: r.embedding_status === INDEXED_IN_MAIL ? 'already settled' : null,
  })),
  ...((oppRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    fileName: (r.file_name as string) ?? '',
    side: 'opportunity' as Side,
    recordId: r.opportunity_id as string,
    chunks: 0,
    ownChars: 0,
    threadId: (r.source_thread_id as string | null) ?? null,
    skipped: r.embedding_status === INDEXED_IN_MAIL ? 'already settled' : null,
  })),
]

console.log(`${candidates.length} live correspondence documents across both tables.`)

// ---------------------------------------------------------------------------
// 2. Which thread delivered each one
// ---------------------------------------------------------------------------

const open = candidates.filter((c) => !c.skipped)

// Every thread filed against any of these records, and what its mail index
// holds. Two reads rather than one per document.
const recordKeys = [...new Set(open.map((c) => `${c.side}:${c.recordId}`))]
const linksByRecord = new Map<string, string[]>()
for (const key of recordKeys) {
  const [kind, id] = key.split(':')
  const { data, error } = await supabase
    .from('thread_links')
    .select('thread_id')
    .eq('record_kind', kind)
    .eq('record_id', id)
  if (error) throw new Error(`could not read thread_links for ${key}: ${error.message}`)
  linksByRecord.set(
    key,
    ((data ?? []) as Array<{ thread_id: string | null }>)
      .map((l) => l.thread_id)
      .filter((t): t is string => !!t)
  )
}

const allThreadIds = [...new Set([...linksByRecord.values()].flat())]
/** thread id -> the lowercased attachment names its chunks hold. */
const indexed = new Map<string, Set<string>>()
/**
 * thread id -> name -> how many characters of that file the mail index holds.
 *
 * ⚠ PRESENCE IS NOT COVERAGE. `readAttachmentText` caps an attachment at
 * MAX_ATTACHMENT_CHARS (200,000) where a document's stored text is capped at
 * LOCAL_PDF_TEXT_MAX_CHARS (2,000,000), so a long enough agreement could be in
 * the mail index as a truncated head — and deleting the document's own chunks
 * on the strength of a first page would quietly lose the rest.
 *
 * Measured across all 91 comparable documents before this guard was written:
 * every one of them is at 97.2% or better, so the guard fires on nothing today.
 * It is here for the document that has not arrived yet.
 */
const mailChars = new Map<string, number>()
const ID_CHUNK = 200
const PAGE = 1000
for (let start = 0; start < allThreadIds.length; start += ID_CHUNK) {
  const ids = allThreadIds.slice(start, start + ID_CHUNK)
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('thread_chunks')
      .select('thread_id, attachment_name, content')
      .in('thread_id', ids)
      .eq('source', 'attachment')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`could not read thread_chunks: ${error.message}`)
    const page = (data ?? []) as Array<{
      thread_id: string | null
      attachment_name: string | null
      content: string | null
    }>
    for (const c of page) {
      if (!c.thread_id || !c.attachment_name) continue
      const name = c.attachment_name.toLowerCase()
      const set = indexed.get(c.thread_id) ?? new Set<string>()
      set.add(name)
      indexed.set(c.thread_id, set)
      const key = `${c.thread_id}:${name}`
      mailChars.set(key, (mailChars.get(key) ?? 0) + (c.content?.length ?? 0))
    }
    if (page.length < PAGE) break
    from += PAGE
  }
}

for (const c of open) {
  const threads = linksByRecord.get(`${c.side}:${c.recordId}`) ?? []
  const carrying = threads.filter((t) => indexed.get(t)?.has(c.fileName.toLowerCase()))
  if (carrying.length === 0) {
    c.skipped = 'not in the mail index'
    continue
  }
  if (carrying.length > 1) {
    // The text IS searchable — but which thread delivered it is unknowable from
    // here, and a stored pointer has to be true.
    c.skipped = `ambiguous (${carrying.length} threads carry this name)`
    continue
  }
  c.threadId = carrying[0]
}

// ---------------------------------------------------------------------------
// 3. What it reclaims
// ---------------------------------------------------------------------------

const withThread = open.filter((c) => !c.skipped && c.threadId)
for (const c of withThread) {
  const column = c.side === 'project' ? 'document_id' : 'opportunity_document_id'
  const { data, error } = await supabase
    .from('chunks')
    .select('content')
    .eq(column, c.id)
    .range(0, PAGE - 1)
  if (error) throw new Error(`could not read chunks for ${c.fileName}: ${error.message}`)
  const own = (data ?? []) as Array<{ content: string | null }>
  c.chunks = own.length
  c.ownChars = own.reduce((a, r) => a + (r.content?.length ?? 0), 0)

  // The guard. A mail index holding materially less than the document's own
  // text is a truncated head, and the document keeps its chunks.
  const held = mailChars.get(`${c.threadId}:${c.fileName.toLowerCase()}`) ?? 0
  if (c.ownChars > 0 && held < c.ownChars * 0.9) {
    c.skipped = `mail index holds only ${Math.round((100 * held) / c.ownChars)}% of its text`
  }
}

const resolved = withThread.filter((c) => !c.skipped)

const toClear = resolved.filter((c) => c.chunks > 0)
const alreadyClear = resolved.filter((c) => c.chunks === 0)

const reasons = new Map<string, number>()
for (const c of open) if (c.skipped) reasons.set(c.skipped, (reasons.get(c.skipped) ?? 0) + 1)

console.log({
  alreadySettled: candidates.filter((c) => c.skipped === 'already settled').length,
  resolvedToOneThread: resolved.length,
  holdingDuplicateChunks: toClear.length,
  duplicateChunks: toClear.reduce((a, c) => a + c.chunks, 0),
  // Resolved, no chunks of their own: the thread is backfilled and the status
  // settled, but there is nothing to delete. These are what make a second run
  // report nothing rather than repeating itself.
  resolvedNothingToDelete: alreadyClear.length,
  passedOver: Object.fromEntries(reasons),
})

if (toClear.length > 0) {
  console.log('\nBiggest footprints:')
  for (const c of [...toClear].sort((a, b) => b.chunks - a.chunks).slice(0, 12)) {
    console.log(`  ${String(c.chunks).padStart(4)}  ${c.fileName}`)
  }
}

if (DRY) {
  console.log('\n--dry: nothing written.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 4. Write
// ---------------------------------------------------------------------------

let cleared = 0
let chunksDeleted = 0
for (const c of resolved) {
  const table = c.side === 'project' ? 'documents' : 'opportunity_documents'
  const column = c.side === 'project' ? 'document_id' : 'opportunity_document_id'

  if (c.chunks > 0) {
    const { error } = await supabase.from('chunks').delete().eq(column, c.id)
    if (error) {
      console.error(`  ! ${c.fileName}: ${error.message}`)
      continue
    }
    chunksDeleted += c.chunks
  }

  // Status and thread in one write, so a row can never be left settled with no
  // thread on it — which the reconcile pass would then never examine.
  const { error: upErr } = await supabase
    .from(table)
    .update({ embedding_status: INDEXED_IN_MAIL, source_thread_id: c.threadId })
    .eq('id', c.id)
  if (upErr) {
    console.error(`  ! ${c.fileName}: ${upErr.message}`)
    continue
  }
  cleared++
}

console.log({ documentsSettled: cleared, chunksDeleted })
console.log('\nRun again — it must report 0 holdingDuplicateChunks.')
