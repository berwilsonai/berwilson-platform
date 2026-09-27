/**
 * Re-run the document AI pass on spreadsheets that hold no text.
 *
 * Until 2026-09-26 `documentKind` classified .xlsx as 'unsupported', so an
 * uploaded workbook was stored with a file and no extracted text — Ber AI could
 * see that the file existed and nothing more. The Alaska project's
 * `Full Claim List.xlsx` was one of them, and it holds the claim schedule that
 * answers where that land is: 50 state claims by ADL number, Fairbanks
 * Meridian, township and quarter-quarter section. The agent was asked for the
 * location three times and could not reach it.
 *
 * Only rows with no extracted_text are touched, so re-running is cheap and safe.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/reindex-spreadsheets.mts [--dry]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass, documentKind } from '@/lib/ai/document-pipeline'

const dry = process.argv.includes('--dry')
const supabase = createAdminClient()

const { data, error } = await supabase
  .from('documents')
  .select('id, file_name, mime_type, storage_path, project_id, entity_id, is_company, extracted_text')
  .is('superseded_at', null)

if (error) {
  console.error(error.message)
  process.exit(1)
}

const stale = (data ?? []).filter(
  (d) =>
    documentKind(d.mime_type, d.file_name) === 'xlsx' &&
    !(d.extracted_text ?? '').trim()
)

console.log(`${stale.length} spreadsheet(s) with no stored text`)
for (const d of stale) console.log(`  ${d.file_name}`)
if (dry || stale.length === 0) {
  console.log(dry ? '\n--dry: nothing run.' : '\nNothing to do.')
  process.exit(0)
}

let recovered = 0
for (const d of stale) {
  const t0 = Date.now()
  const { data: blob, error: dlError } = await supabase.storage
    .from('documents')
    .download(d.storage_path)
  if (dlError || !blob) {
    console.log(`  ✗ ${d.file_name} — file missing from storage: ${dlError?.message ?? 'not found'}`)
    continue
  }

  // Clear old chunks so a re-run never double-indexes.
  await supabase.from('chunks').delete().eq('document_id', d.id)

  const result = await runDocumentAiPass({
    supabase,
    documentId: d.id,
    projectId: d.project_id,
    entityId: d.entity_id,
    isCompany: d.is_company ?? false,
    fileName: d.file_name,
    mimeType: d.mime_type,
    buffer: await blob.arrayBuffer(),
  })

  const { data: after } = await supabase
    .from('documents')
    .select('extracted_text')
    .eq('id', d.id)
    .single()
  const chars = (after?.extracted_text ?? '').length
  if (chars > 0) recovered++
  console.log(
    `  ${chars > 0 ? '✓' : '✗'} ${d.file_name} — ${result.status}, ${chars} chars (${Math.round((Date.now() - t0) / 1000)}s)`
  )
}

console.log(`\n${recovered}/${stale.length} now hold text.`)
