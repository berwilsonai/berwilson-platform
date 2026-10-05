/**
 * Re-run the document AI pass on opportunity documents that hold no text.
 *
 * `documents` has POST /api/documents/[id]/reindex for this; opportunity
 * documents have no equivalent, so a row left with a file and no extracted
 * text is invisible to Ber AI with nothing coming back for it. Two fixed
 * defects put rows in exactly that state and this is how they are cleared:
 * a summary failure used to discard the text alongside it, and the Gemini
 * inline-request size ceiling was being applied to the local extractor, which
 * makes no request at all.
 *
 * Only rows with no extracted_text are touched, so re-running is cheap and safe.
 *
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/reindex-opportunity-documents.mts \
 *        [--opportunity <uuid>] [--dry]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { processPromotedDocumentAi } from '@/lib/email-ingestion/attachments'

/**
 * `opportunity_documents` is absent from the generated types (CLAUDE.md §4), so
 * the row contract is hand-maintained here — the same convention `sweepDb()`
 * uses. It was four `any` escapes until 2026-10-05, against a repo rule of
 * zero.
 */
type OppDocRow = {
  id: string
  opportunity_id: string
  file_name: string
  mime_type: string | null
  storage_path: string
  file_size_bytes: number | null
  extracted_text: string | null
}

const dry = process.argv.includes('--dry')
const oppIdx = process.argv.indexOf('--opportunity')
const onlyOpportunity = oppIdx >= 0 ? process.argv[oppIdx + 1] : null

const supabase = createAdminClient()

let q = supabase
  .from('opportunity_documents')
  .select('id, opportunity_id, file_name, mime_type, storage_path, file_size_bytes, extracted_text')
if (onlyOpportunity) q = q.eq('opportunity_id', onlyOpportunity)

const { data, error } = await q
if (error) {
  console.error(error.message)
  process.exit(1)
}

const rows = (data ?? []) as unknown as OppDocRow[]
const stale = rows.filter((d) => !d.extracted_text || d.extracted_text.length === 0)
console.log(`${rows.length} opportunity document(s); ${stale.length} with no stored text`)
for (const d of stale) {
  console.log(`  ${d.file_name} (${Math.round((d.file_size_bytes ?? 0) / 1024)}KB, ${d.mime_type})`)
}
if (dry || stale.length === 0) {
  console.log(dry ? '\n--dry: nothing run.' : '\nNothing to do.')
  process.exit(0)
}

console.log('\nRe-running the AI pass one at a time…')
let recovered = 0
for (const [i, d] of stale.entries()) {
  const t0 = Date.now()
  await processPromotedDocumentAi({
    table: 'opportunity_documents',
    id: d.id,
    parentId: d.opportunity_id,
    storagePath: d.storage_path,
    fileName: d.file_name,
    mimeType: d.mime_type,
  })
  const { data: after } = await supabase
    .from('opportunity_documents')
    .select('extracted_text')
    .eq('id', d.id)
    .single()
  const len = (after as unknown as { extracted_text: string | null } | null)?.extracted_text?.length ?? 0
  if (len > 0) recovered++
  console.log(
    `  [${i + 1}/${stale.length}] ${d.file_name} — ${Math.round((Date.now() - t0) / 1000)}s, text ${len}`
  )
}
console.log(`\nRecovered text on ${recovered}/${stale.length}. The rest are genuinely unreadable (scanned, image-only, or password-protected).`)
