/**
 * Retire cross-source duplicate documents.
 *
 * Hand upload, email-attachment import and Drive sync are three independent
 * doors, and each dedupes only within its own key (`drive_file_id`, or file name
 * within one record). A file that arrived as an email attachment and later
 * appeared in the team's Drive folder is therefore imported twice — live on this
 * data, the Stockton Power Nexus proposal and its one-page briefing are both
 * indexed in duplicate, and the Myton predevelopment package three times.
 *
 * The cost is retrieval quality, not storage. A near-duplicate doubles a
 * document's chunks and biases every retrieval toward whatever was duplicated:
 * asked for the status of the Stockton pursuit, four of the top six passages
 * were two documents saying the same thing twice.
 *
 * WHAT THIS DOES AND DOES NOT DO. It supersedes the duplicate — drops its chunks
 * so the retriever stops citing it — and keeps the row and the stored file. It
 * never deletes. The Archive convention (CLAUDE.md, 2026-09-09) is the chosen
 * way to retire a document and this respects it: the copy kept is the one the
 * team can still reach, which is the Drive-sourced copy where there is one,
 * because dragging that into an Archive folder is the gesture they already know.
 *
 * Run:  node --experimental-strip-types --import ./deploy/register.mjs \
 *            --env-file=.env.local scripts/dedupe-documents.mts [--apply]
 * Dry run by default; --apply is required to change anything.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { supersedeDocument } from '@/lib/drive/supersede'
import { createHash } from 'node:crypto'

const APPLY = process.argv.includes('--apply')

interface DocRow {
  id: string
  project_id: string | null
  is_company: boolean | null
  file_name: string | null
  extracted_text: string | null
  drive_file_id: string | null
  uploaded_at: string | null
  embedding_status: string | null
  superseded_at: string | null
}

/**
 * Two copies of one PDF extracted on different days differ by line wrapping
 * alone, so the text is normalised before hashing. Documents with no extracted
 * text are compared by name within the same record instead — there is nothing
 * else to go on, and a same-name file on the same project genuinely is the
 * same document.
 */
function contentKey(doc: DocRow): string | null {
  const text = (doc.extracted_text ?? '').replace(/\s+/g, ' ').trim()
  const scope = doc.project_id ?? (doc.is_company ? 'company' : 'unscoped')
  if (text.length >= 200) {
    return `${scope}:sha:${createHash('sha256').update(text).digest('hex')}`
  }
  const name = (doc.file_name ?? '').toLowerCase().trim()
  return name ? `${scope}:name:${name}` : null
}

/**
 * Which copy survives — and the Drive-sourced copy must, for two reasons.
 *
 * Mechanically: `importDriveFolder` treats a superseded Drive document that is
 * still present in the folder as "returning" and restores it on the next sync,
 * so superseding that copy would simply be undone overnight. Practically: it is
 * the copy a human can retire, by dragging it into an Archive subfolder — the
 * gesture the team already has. Failing that, the copy with more extracted text,
 * then the older one (whatever has been linked to for longer).
 */
function preferred(a: DocRow, b: DocRow): DocRow {
  if (!!a.drive_file_id !== !!b.drive_file_id) return a.drive_file_id ? a : b
  const aLen = a.extracted_text?.length ?? 0
  const bLen = b.extracted_text?.length ?? 0
  if (aLen !== bLen) return aLen > bLen ? a : b
  return (a.uploaded_at ?? '') <= (b.uploaded_at ?? '') ? a : b
}

const admin = createAdminClient()

const { data, error } = await admin
  .from('documents')
  .select('id, project_id, is_company, file_name, extracted_text, drive_file_id, uploaded_at, embedding_status, superseded_at')
  .order('uploaded_at', { ascending: true })

if (error) throw new Error(`Could not read documents: ${error.message}`)

const docs = (data ?? []) as unknown as DocRow[]
// An already-superseded document is out of the index by definition; including
// it would make the script re-report work it already did.
const live = docs.filter((d) => !d.superseded_at)

const groups = new Map<string, DocRow[]>()
for (const doc of live) {
  const key = contentKey(doc)
  if (!key) continue
  const list = groups.get(key) ?? []
  list.push(doc)
  groups.set(key, list)
}

const duplicates = [...groups.values()].filter((g) => g.length > 1)

console.log(`${live.length} live documents, ${duplicates.length} duplicated group(s).\n`)

let retired = 0
let skipped = 0
let chunksDropped = 0

for (const group of duplicates) {
  const keep = group.reduce(preferred)
  const drop = group.filter((d) => d.id !== keep.id)

  console.log(`• ${keep.file_name ?? '(unnamed)'}  — ${group.length} copies`)
  console.log(`    keep  ${keep.id}${keep.drive_file_id ? ' (from Drive)' : ''} — ${keep.extracted_text?.length ?? 0} chars`)

  for (const doc of drop) {
    const { count } = await admin
      .from('chunks')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', doc.id)

    // A Drive-sourced copy cannot be retired from here. `importDriveFolder`
    // treats a superseded document that is still present in its folder as
    // "returning" and restores it on the next sync, so this would be undone
    // overnight — and the platform would have quietly disagreed with Drive in
    // the meantime. The same file living in two nominated folders is a filing
    // decision, and the Archive convention is how a human makes it.
    if (doc.drive_file_id) {
      console.log(
        `    skip  ${doc.id} (from Drive) — ${count ?? 0} chunks; both copies are in Drive, so retire one by moving it to an Archive subfolder`
      )
      skipped++
      continue
    }

    console.log(`    drop  ${doc.id} — ${count ?? 0} chunks`)

    if (APPLY) {
      // Reuses the platform's own supersede path — chunks first, then the flag,
      // so a failure can never leave a document reading as retired while still
      // answering questions.
      const ok = await supersedeDocument(
        admin,
        doc.id,
        `duplicate of ${keep.file_name ?? keep.id} already indexed on this record`
      )
      if (!ok) {
        console.error('      supersede failed — left in place')
        continue
      }
    }
    retired++
    chunksDropped += count ?? 0
  }
}

console.log(
  `\n${APPLY ? 'Retired' : 'Would retire'} ${retired} duplicate document(s), ${APPLY ? 'dropping' : 'freeing'} ${chunksDropped} chunk(s).`
)
if (skipped > 0) {
  console.log(
    `${skipped} duplicate(s) left alone because both copies live in Drive — move one into an Archive subfolder to retire it.`
  )
}
if (!APPLY) console.log('Dry run — pass --apply to make the change.')
