/**
 * Set aside the calendar invites and unnamed mail-client images already on file.
 *
 * ⚠ SCOPE IS DELIBERATELY NARROW, AND THE FIRST ATTEMPT AT IT WAS WRONG. The
 * plan was "exclude the 60 images and invites". Reading them first killed that:
 * the project-filed images are REAL DILIGENCE DOCUMENTS — 15 scanned 2007 bridge
 * inspection sheets on Weirton, 20 scanned survey plats on Helper, the Millard
 * County zoning exhibit for Daves Farms, two Alaska claim maps. Excluding by
 * mime type would have deleted the chunks of all of them. §12 again: the bloat
 * has never once been where the rule assumed.
 *
 * What is actually chrome, and nothing else:
 *   - `.ics` / `.vcf`: a calendar invite is not a document. `isFileable` has
 *     always said so; it was only ever asked when filing to Drive.
 *   - `image00N.png` and `noname`: a mail client's own artefacts. The predicate
 *     is `isMailChrome`, used here rather than re-expressed.
 *
 * Dry by default. Pass --apply to write.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { isMailChrome } from '@/lib/email-sweep/attachment-hygiene'
import { isFileable } from '@/lib/drive/file-document'
import { excludeDocument, type DocumentSource } from '@/lib/documents/refile'

const APPLY = process.argv.includes('--apply')
const db = createAdminClient()

const REASON = 'A calendar invite or a mail-client artefact, not a document.'

type Row = { id: string; file_name: string; mime_type: string | null; file_size_bytes: number | null }

let total = 0
let chunksGone = 0
for (const source of ['documents', 'opportunity_documents'] as DocumentSource[]) {
  const { data, error } =
    source === 'documents'
      ? await db.from('documents').select('id, file_name, mime_type, file_size_bytes')
          .is('superseded_at', null).is('excluded_at', null)
      : await db.from('opportunity_documents').select('id, file_name, mime_type, file_size_bytes')
          .is('superseded_at', null).is('excluded_at', null)
  if (error) { console.error(`read ${source} failed:`, error.message); process.exit(1) }

  for (const r of (data ?? []) as Row[]) {
    const mime = r.mime_type ?? ''
    const chrome =
      !isFileable(r.file_name, r.mime_type) ||
      isMailChrome(r.file_name, mime, r.file_size_bytes ?? 0)
    if (!chrome) continue
    total++
    console.log(`${APPLY ? 'exclude' : '  would'} ${source.padEnd(22)} ${r.file_name.slice(0, 48)}`)
    if (!APPLY) continue
    try {
      const { chunks } = await excludeDocument(db, r.id, REASON, source)
      chunksGone += chunks
    } catch (err) {
      console.error(`  ! ${r.file_name}:`, err instanceof Error ? err.message : err)
    }
  }
}
console.log(`\n${APPLY ? 'excluded' : 'would exclude'} ${total} row(s)${APPLY ? `, ${chunksGone} chunk(s) removed` : ''}`)
