/**
 * Retire duplicate documents — the SAME BYTES on the SAME record.
 *
 * Hand upload, email-attachment import and the two Drive syncs are four
 * independent doors. Each used to dedupe only within its own key, so a file that
 * arrived as an attachment and later appeared in the team's Drive folder was
 * imported twice, and the same file filed under two Drive folders twice more.
 * The cost is retrieval quality, not storage: a duplicate doubles a document's
 * chunks and biases every search toward whatever was duplicated.
 *
 * WHAT CHANGED 2026-10-09. Two things this script could not do before:
 *
 *   * Every document now carries `content_sha256` (all four doors write it, and
 *     `scripts/backfill-document-hashes.mts` filled the 614 rows that predate
 *     that). So grouping is on BYTES, exactly, rather than on a normalised hash
 *     of extracted text — which grouped four different Stockton site photos
 *     whose OCR text happened to agree.
 *   * A retirement now STICKS. `superseded_by_hand` is held out of both Drive
 *     importers' `known` map, so the `returning` branch can no longer un-retire
 *     it overnight. That branch is why this script previously refused to act on
 *     48 of the 53 groups it found: superseding a Drive-sourced copy would have
 *     been reversed by the next nightly sync, and the platform would have
 *     quietly disagreed with Drive in the meantime.
 *
 * ⚠ AND THE GUARD THAT MATTERS: IDENTICAL BYTES ARE NOT THE SAME DOCUMENT WHEN
 * THE NAME IS THE ONLY THING CARRYING THE DISTINCTION. Found live on this data:
 * `BW MNDA DA Davidson`, `BW MNDA Tyler`, `BW MNDA Sean Reyes` and `BW MNDA Firm
 * Power` are four byte-identical copies of the blank template, one prepared per
 * counterparty and none filled in yet. Retiring three of them loses nothing from
 * retrieval and destroys the only record that an NDA was drafted for three of
 * those four parties. So a group is acted on only when the names AGREE once the
 * mechanical decoration is stripped — `Copy of`, `- Copy`, `(2)`, `[1]`, a
 * Google-export timestamp tail, a trailing email-subject parenthetical. A group
 * whose names disagree is printed for a person and nothing is done to it.
 *
 * It supersedes the duplicate — drops its chunks so the retriever stops citing
 * it — and keeps the row, the stored file, and its place on the record, with
 * `duplicate_of` pointing at the copy that was kept so the screen can say so and
 * "not a duplicate" is one click. It never deletes, and it never touches Drive:
 * the team's filing is not ours to rearrange.
 *
 * Run:  node --experimental-strip-types --import ./deploy/register.mjs \
 *            --env-file=.env.local scripts/dedupe-documents.mts [--apply]
 * Dry run by default; --apply is required to change anything.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { supersedeDocument, type DocumentTable } from '@/lib/drive/supersede'

const APPLY = process.argv.includes('--apply')

/**
 * One candidate row, from either table, with its record already resolved.
 *
 * The two tables carry different parent columns, so the scope is worked out at
 * load time and everything below this point is table-agnostic — one pass with a
 * target, never a forked copy per table.
 */
interface DocRow {
  id: string
  scope: string
  file_name: string | null
  content_sha256: string | null
  extracted_text: string | null
  drive_file_id: string | null
  drive_folder_path: string | null
  uploaded_at: string | null
}

/**
 * Which record the document hangs off.
 *
 * ⚠ THE SCOPE IS ONE RECORD, NEVER THE PLATFORM. The Cleveland-Cliffs
 * due-diligence package is byte-identical on Weirton, Steelton and Riverdale
 * because it genuinely covers all three sites; a platform-wide hash check would
 * retire two thirds of it. The eight documents belonging to no record at all are
 * NOT pooled into one scope for the same reason — they are given their own id as
 * their scope, so they can never be compared with each other.
 */
function scopeOf(row: {
  id: string
  project_id?: string | null
  is_company?: boolean | null
  meeting_id?: string | null
  entity_id?: string | null
  opportunity_id?: string | null
}): string {
  if (row.opportunity_id) return `opportunity:${row.opportunity_id}`
  if (row.project_id) return `project:${row.project_id}`
  if (row.is_company) return 'company'
  if (row.meeting_id) return `meeting:${row.meeting_id}`
  if (row.entity_id) return `entity:${row.entity_id}`
  return `loose:${row.id}`
}

/**
 * The file name with the mechanical decoration taken off — what two copies of
 * one document have in common and what two different documents do not.
 *
 * Deliberately exact after normalising, never fuzzy: the whole job of this
 * function is to refuse the DA Davidson / Tyler group, and any tolerance wide
 * enough to call those the same name is wide enough to lose a document.
 */
export function nameStem(name: string | null): string {
  let s = (name ?? '').toLowerCase()
  s = s.replace(/\.[a-z0-9]{2,5}$/, '') // extension

  // ⚠ DECORATION NESTS, SO ONE PASS IS NOT ENOUGH. Live example: "Elite
  // Solutions MNDA … .docx - 9/23/26, 12:08 PM (eSigned Document Ready …).pdf"
  // carries an email-subject parenthetical AFTER an export timestamp, so a
  // single pass strips the parenthetical, leaves the timestamp stranded at the
  // end, and the stem no longer matches its own twin — the pair was held back as
  // "different names" when it is plainly the same file. Run to a fixpoint. The
  // loop is bounded because every rule only ever shortens the string.
  for (let last = ''; s !== last; ) {
    last = s
    s = s.replace(/^copy of\s+/, '') // Drive's copy prefix
    s = s.replace(/\s*-\s*copy\b/g, '') // …and its suffix form
    // A Google-Docs export tail: " - 9/7/26, 11:04 AM", " - 9_24_26, 9_43 AM",
    // and the form whose punctuation was already stripped, " - 10726, 921 AM".
    s = s.replace(/\s*-\s*[0-9][0-9/_.]{3,9},?\s*[0-9]{1,2}[:_.]?[0-9]{2}\s*(am|pm)?\s*$/, '')
    s = s.replace(/\s*[([][0-9]{1,2}[)\]]\s*$/, '') // a trailing (2) or [1]
    s = s.replace(/\s*\([^()]{3,}\)\s*$/, '') // a trailing email-subject parenthetical
    s = s.replace(/\.[a-z0-9]{2,5}$/, '') // a second extension, e.g. "…docx.pdf"
    s = s.trim()
  }
  return s.replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * How much mechanical decoration a name carries. Lower is the better name.
 *
 * All of this is added by a MACHINE, never typed by a person: Drive's "Copy of"
 * prefix and "- Copy" suffix, its "(2)" download counter, and our own
 * `disambiguateName` trailing parenthetical — which exists ONLY because the name
 * collided with one already on the record. Retiring the duplicate removes the
 * collision, so the surviving copy no longer needs the disambiguation and the
 * plain name is the right one to show.
 *
 * ⚠ A TRAILING PARENTHETICAL THAT IS AN IDENTIFIER IS NOT DECORATION. Four
 * parcels' title commitments are all called "Title Commitment - AS.pdf", so
 * "(02-0138-0000)" is the only thing saying WHICH parcel — the parenthetical
 * carrying it is worth more than the bare name, not less.
 */
function decorationScore(name: string | null): number {
  const n = (name ?? '').toLowerCase()
  let score = 0
  if (/^copy of\s+/.test(n)) score++
  score += (n.match(/\s*-\s*copy\b/g) ?? []).length
  score += (n.match(/\s*[([][0-9]{1,2}[)\]]/g) ?? []).length
  const trailing = n.match(/\(([^()]{3,})\)\s*(\.[a-z0-9]{2,5})?$/)
  // Mostly digits, dashes and dots = a parcel number or a document number. Prose
  // = an email subject our own importer appended.
  if (trailing && !/^[0-9][0-9\-. ]*$/.test(trailing[1].trim())) score++
  return score
}

/**
 * Which copy survives.
 *
 * The Drive-sourced copy first: it is the one a human can still retire by
 * dragging it into an Archive subfolder, which is the gesture the team already
 * has. Then the one with more extracted text. Then the least machine-decorated
 * name — without this the script kept "Copy of Tensor MNDA" over "Tensor MNDA"
 * and "R0183 (1).pdf" over "R0183.pdf", because an earlier tiebreak on name
 * LENGTH rewarded exactly the noise it was meant to drop. Then the older row,
 * which is whatever has been linked to for longest.
 */
function preferred(a: DocRow, b: DocRow): DocRow {
  if (!!a.drive_file_id !== !!b.drive_file_id) return a.drive_file_id ? a : b

  const aLen = a.extracted_text?.length ?? 0
  const bLen = b.extracted_text?.length ?? 0
  // Text or no text is a real difference — one copy's AI pass finished and the
  // other's did not. The LENGTH is not: measured 2026-10-09 across the 42
  // byte-identical groups, only three differ at all and those by 0.1–0.4%, which
  // is extraction jitter on the same bytes rather than a better read. Ranking on
  // it kept "R0183 (1).pdf" over "R0183.pdf" for 182 characters of noise.
  if (aLen > 0 !== bLen > 0) return aLen > 0 ? a : b

  const aDec = decorationScore(a.file_name)
  const bDec = decorationScore(b.file_name)
  if (aDec !== bDec) return aDec < bDec ? a : b

  if (aLen !== bLen) return aLen > bLen ? a : b
  return (a.uploaded_at ?? '') <= (b.uploaded_at ?? '') ? a : b
}

const admin = createAdminClient()

/** Where a table keeps its chunks — the key that must be counted and dropped. */
const CHUNK_KEY: Record<DocumentTable, 'document_id' | 'opportunity_document_id'> = {
  documents: 'document_id',
  opportunity_documents: 'opportunity_document_id',
}

/**
 * Load one table's live rows.
 *
 * Paged: PostgREST truncates at 1000 rows silently. Branched on the table rather
 * than parameterised, because a union of table names loses the column types the
 * generated client checks against — the same reason the attachment importer
 * branches its own reads.
 */
async function loadLive(table: DocumentTable): Promise<DocRow[]> {
  const rows: DocRow[] = []
  for (let from = 0; ; from += 1000) {
    const page =
      table === 'opportunity_documents'
        ? await admin
            .from('opportunity_documents')
            .select(
              'id, opportunity_id, file_name, content_sha256, extracted_text, drive_file_id, drive_folder_path, uploaded_at, superseded_at'
            )
            .is('superseded_at', null)
            .order('uploaded_at', { ascending: true })
            .range(from, from + 999)
        : await admin
            .from('documents')
            .select(
              'id, project_id, is_company, entity_id, meeting_id, file_name, content_sha256, extracted_text, drive_file_id, drive_folder_path, uploaded_at, superseded_at'
            )
            .is('superseded_at', null)
            .order('uploaded_at', { ascending: true })
            .range(from, from + 999)
    // ⚠ A zero from a broken query and a zero from an empty table are the same
    // number on screen. Refuse rather than report "nothing duplicated".
    if (page.error) throw new Error(`${table}: could not read rows — ${page.error.message}`)
    const batch = page.data ?? []
    for (const r of batch) rows.push({ ...r, scope: scopeOf(r) })
    if (batch.length < 1000) break
  }
  return rows
}

interface Outcome {
  live: number
  retired: number
  chunksDropped: number
  unhashed: number
  held: { names: string[] }[]
}

async function dedupe(table: DocumentTable): Promise<Outcome> {
  const live = await loadLive(table)
  const out: Outcome = {
    live: live.length,
    retired: 0,
    chunksDropped: 0,
    unhashed: live.filter((d) => !d.content_sha256).length,
    held: [],
  }

  const groups = new Map<string, DocRow[]>()
  for (const doc of live) {
    if (!doc.content_sha256) continue
    const key = `${doc.scope}:${doc.content_sha256}`
    const list = groups.get(key) ?? []
    list.push(doc)
    groups.set(key, list)
  }
  const duplicated = [...groups.values()].filter((g) => g.length > 1)

  console.log(`\n${table}: ${live.length} live, ${duplicated.length} byte-identical group(s).`)
  if (out.unhashed > 0) {
    console.log(
      `⚠ ${out.unhashed} row(s) carry no content hash and were NOT compared — run scripts/backfill-document-hashes.mts first.`
    )
  }

  for (const group of duplicated) {
    const stems = new Set(group.map((d) => nameStem(d.file_name)))

    // ⚠ Same bytes, different names: the name is the only thing telling these
    // apart, so a merge would destroy the distinction silently. Reported, never
    // acted on.
    if (stems.size > 1) {
      out.held.push({ names: group.map((d) => d.file_name ?? '(unnamed)') })
      continue
    }

    const keep = group.reduce(preferred)
    const drop = group.filter((d) => d.id !== keep.id)

    console.log(`• ${keep.file_name ?? '(unnamed)'} — ${group.length} identical copies`)
    console.log(`    keep  ${keep.id}${keep.drive_folder_path ? `  ${keep.drive_folder_path}` : ''}`)

    for (const doc of drop) {
      const { count } = await admin
        .from('chunks')
        .select('id', { count: 'exact', head: true })
        .eq(CHUNK_KEY[table], doc.id)

      console.log(
        `    drop  ${doc.id}  ${doc.file_name ?? '(unnamed)'}${doc.drive_folder_path ? `  [${doc.drive_folder_path}]` : ''} — ${count ?? 0} chunks`
      )

      if (APPLY) {
        // The platform's own supersede path: chunks first, then the flag, so a
        // failure can never leave a document reading as retired while it is
        // still answering questions. `duplicateOf` carries the lock with it,
        // which is what stops the next Drive sync undoing this.
        const ok = await supersedeDocument(
          admin,
          doc.id,
          `Byte-identical duplicate of ${keep.file_name ?? keep.id} already on this record.`,
          { duplicateOf: keep.id, table }
        )
        if (!ok) {
          console.error('      supersede failed — left in place')
          continue
        }
      }
      out.retired++
      out.chunksDropped += count ?? 0
    }
  }

  return out
}

// Both tables. A document can live in either (§9's two-table split), so a pass
// that covers one of them leaves the other half of the corpus reading as clean.
const results: [DocumentTable, Outcome][] = []
for (const table of ['documents', 'opportunity_documents'] as DocumentTable[]) {
  results.push([table, await dedupe(table)])
}

console.log('')
for (const [table, r] of results) {
  console.log(
    `${table}: ${APPLY ? 'retired' : 'would retire'} ${r.retired} duplicate(s), ${APPLY ? 'dropped' : 'freeing'} ${r.chunksDropped} chunk(s); ${r.held.length} group(s) held back.`
  )
}

const held = results.flatMap(([, r]) => r.held)
if (held.length > 0) {
  console.log(
    `\n${held.length} group(s) left alone — identical bytes under DIFFERENT names, so the name is the only thing telling them apart:`
  )
  for (const h of held) console.log(`  • ${h.names.join('  |  ')}`)
  console.log('  Decide these by hand on the record; retiring one would lose what its name records.')
}

if (!APPLY) console.log('\nDry run — pass --apply to make the change.')
