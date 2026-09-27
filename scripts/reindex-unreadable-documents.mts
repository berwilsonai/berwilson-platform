/**
 * Re-run the document AI pass on every document that holds no extractable text.
 *
 * Three fixed defects put documents in that state, and this clears all of them:
 *   - .xlsx was classified 'unsupported', so a workbook stored zero text
 *     (the Alaska `Full Claim List.xlsx`, holding the 69-claim schedule).
 *   - scanned/image-only PDFs had no OCR fallback — 30 of 315 live PDFs,
 *     including `Lease ADL421724.pdf`, whose acreage the agent was asked for
 *     three times and could not reach.
 *   - images were never read at all.
 *
 * Only rows with no extracted_text are touched, so re-running is cheap and safe.
 * Progress is written back after EVERY document, so an interrupted run resumes
 * rather than restarts (§12 — a deploy is a `launchctl kickstart`).
 *
 * On this box, run it with `--text-only` after `lms unload qwen/qwen3.6-35b-a3b`:
 * OCR is Apple Vision and needs no model, while the summary is a 30-60s call to
 * a 22GB model that leaves the Studio 20GB into swap — which is what made the
 * first attempt fail intermittently and mark readable documents as skipped.
 * Extract the text first (minutes, no model); fill in summaries later.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/reindex-unreadable-documents.mts \
 *        [--kind pdf|image|xlsx|docx|text] [--project <uuid>] [--limit N]
 *        [--text-only] [--unembedded] [--missing-summary] [--dry]
 *
 * `--missing-summary` selects documents that hold text but have no ai_summary —
 * the state `--text-only` leaves them in. That is NOT cosmetic: `list_documents`
 * and `get_record_brief` show a document by its summary, so a document with a
 * NULL one reads to the agent as holding nothing and never gets opened. Measured
 * 2026-09-26: with the scanned lease extracted but unsummarized, Ber AI answered
 * "the lease ADL-421724 document is a scanned PDF the platform cannot read" while
 * `get_document_content` returned its 665 acres on request. Run this pass with
 * the LLM loaded, after the text pass.
 *
 * `--unembedded` switches the selection to documents that DO hold text but have
 * no chunks — invisible to Ber AI's retrieval for a different reason, and worth
 * a pass of its own. Measured 2026-09-26: five such documents held 293,229
 * characters between them, including the email-research file carrying the Alaska
 * township grid.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass, documentKind, type DocumentKind } from '@/lib/ai/document-pipeline'

const argv = process.argv
const dry = argv.includes('--dry')
const arg = (flag: string): string | null => {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const textOnly = argv.includes('--text-only')
const unembedded = argv.includes('--unembedded')
const missingSummary = argv.includes('--missing-summary')
const onlyKind = arg('--kind') as DocumentKind | null
const onlyProject = arg('--project')
const limit = Number(arg('--limit')) || Infinity

const supabase = createAdminClient()

let q = supabase
  .from('documents')
  .select('id, file_name, mime_type, storage_path, project_id, entity_id, is_company, extracted_text, ai_summary')
  .is('superseded_at', null)
if (onlyProject) q = q.eq('project_id', onlyProject)

const { data, error } = await q
if (error) {
  console.error(error.message)
  process.exit(1)
}

// Which documents have chunks — only needed for --unembedded, and read as ids
// rather than counted per document so one query answers for the whole table.
const embedded = new Set<string>()
if (unembedded) {
  // PostgREST truncates at 1000 rows silently (§12), so page through.
  for (let from = 0; ; from += 1000) {
    const { data: rows, error: cErr } = await supabase
      .from('chunks')
      .select('document_id')
      .not('document_id', 'is', null)
      .range(from, from + 999)
    if (cErr) {
      console.error(cErr.message)
      process.exit(1)
    }
    for (const r of rows ?? []) if (r.document_id) embedded.add(r.document_id)
    if (!rows || rows.length < 1000) break
  }
}

const stale = (data ?? [])
  .filter((d) => {
    const hasText = (d.extracted_text ?? '').trim() !== ''
    if (unembedded) return hasText && !embedded.has(d.id)
    if (missingSummary) return hasText && !(d.ai_summary ?? '').trim()
    return !hasText
  })
  .map((d) => ({ ...d, kind: documentKind(d.mime_type, d.file_name) }))
  .filter((d) => d.kind !== 'unsupported')
  .filter((d) => (onlyKind ? d.kind === onlyKind : true))
  .slice(0, limit === Infinity ? undefined : limit)

const byKind = stale.reduce<Record<string, number>>((acc, d) => {
  acc[d.kind] = (acc[d.kind] ?? 0) + 1
  return acc
}, {})

console.log(
  (textOnly ? '--text-only: extracting and embedding, no AI summary\n' : '') +
  `${stale.length} document(s) ${
    unembedded ? 'holding text but never embedded' : missingSummary ? 'holding text but with no AI summary' : 'with no stored text'
  }` +
    (Object.keys(byKind).length ? ` — ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}` : '')
)
for (const d of stale) console.log(`  [${d.kind}] ${d.file_name}`)
if (dry || stale.length === 0) {
  console.log(dry ? '\n--dry: nothing run.' : '\nNothing to do.')
  process.exit(0)
}

console.log('')
let recovered = 0
let blank = 0
let retry = 0
for (const [i, d] of stale.entries()) {
  const t0 = Date.now()
  const label = `[${i + 1}/${stale.length}] ${d.file_name}`

  const { data: blob, error: dlError } = await supabase.storage.from('documents').download(d.storage_path)
  if (dlError || !blob) {
    console.log(`  ✗ ${label} — missing from storage: ${dlError?.message ?? 'not found'}`)
    continue
  }

  // Clear old chunks so a re-run never double-indexes.
  await supabase.from('chunks').delete().eq('document_id', d.id)

  let status = 'error'
  let retryable = false
  try {
    const result = await runDocumentAiPass({
      supabase,
      documentId: d.id,
      projectId: d.project_id,
      entityId: d.entity_id,
      isCompany: d.is_company ?? false,
      fileName: d.file_name,
      mimeType: d.mime_type,
      buffer: await blob.arrayBuffer(),
      skipSummary: textOnly,
    })
    status = result.status
  } catch (err) {
    // One unreadable document must never end the run — the next one may be fine.
    // An OcrFailedError is the machine being out of memory, not the document
    // being unreadable, so it is counted apart and reported as re-runnable.
    retryable = err instanceof Error && err.name === 'OcrFailedError'
    if (retryable) retry++
    console.log(`  ${retryable ? '⟲' : '✗'} ${label} — ${err instanceof Error ? err.message : String(err)}`)
    continue
  }

  const { data: after } = await supabase
    .from('documents')
    .select('extracted_text, ai_summary')
    .eq('id', d.id)
    .single()
  const chars = (after?.extracted_text ?? '').length
  if (missingSummary && !(after?.ai_summary ?? '').trim()) {
    console.log(`  ✗ ${label} — text present but the summary still did not write`)
    continue
  }
  if (chars > 0) recovered++
  else blank++
  console.log(
    `  ${chars > 0 ? '✓' : '·'} ${label} — ${status}, ${chars.toLocaleString()} chars (${Math.round((Date.now() - t0) / 1000)}s)`
  )
}

console.log(
  `\n${recovered} now hold text; ${blank} genuinely carry none (blank or purely graphical).` +
    (retry > 0
      ? `\n⟲ ${retry} failed for a RETRYABLE reason (the recognizer was killed or timed out — almost always memory).` +
        `\n  Free memory and re-run: \`lms unload qwen/qwen3.6-35b-a3b\` then this script with --text-only.`
      : '')
)
