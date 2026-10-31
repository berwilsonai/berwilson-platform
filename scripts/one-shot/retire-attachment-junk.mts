/**
 * Set aside the junk attachments already on file, using the same door.
 *
 * ⚠ THIS EXISTS BECAUSE §12 SAYS FIXING A GENERATOR CHANGES NOTHING THE READER
 * SEES — the old rows carry the old text. `attachment-hygiene.ts` stops the
 * next `icon.png` arriving; it does nothing about the 58 already sitting in
 * /decide, which is the queue Richard had just clicked through by hand on
 * 2026-10-31 (all 68 unparented images carry `filing_confirmed_at` from that
 * morning). Back them up, then rewrite them.
 *
 * ⚠ IT CALLS `attachmentSkipReason`, NOT A RE-EXPRESSION OF IT. The predicate
 * the door uses IS the predicate here, so the backfill cannot be more or less
 * aggressive than the gate — which is the whole failure mode of a backfill
 * written beside a producer rather than from it (§12: a predicate transcribed
 * into its readers has a home per reader, and the one that lies to you is
 * found last). The same reasoning is why
 * `scripts/one-shot/exclude-mail-chrome.mts` imports `isMailChrome`.
 *
 * ⚠ AND IT IS SCOPED TO UNPARENTED ROWS ONLY — `awaiting_filing = true`.
 * That is deliberate and it is the warning the sibling script left behind: the
 * project-FILED images are real diligence (15 scanned 2007 bridge inspection
 * sheets on Weirton, 20 scanned survey plats on Helper, the Millard County
 * zoning exhibit, two Alaska claim maps), and a pass over every `documents`
 * row would reach them. The door applies the device rule on both paths going
 * forward; this retroactive pass does not, because the cost of a mistake here
 * is a document that already exists and is already filed correctly.
 *
 * ⚠ REVERSIBLE. `excludeDocument` writes a tombstone — the ROW IS THE
 * TOMBSTONE (§4) — so the file is kept, only its indexed passages go, and the
 * nightly Drive sync will not re-import it. Nothing is deleted.
 *
 * Dry by default. Pass --apply to write.
 *
 * Run: node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/one-shot/retire-attachment-junk.mts [--apply]
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  attachmentSkipReason,
  SKIP_REASON_NOTE,
  type SkipReason,
} from '@/lib/email-sweep/attachment-hygiene'
import { excludeDocument } from '@/lib/documents/refile'

const APPLY = process.argv.includes('--apply')
const db = createAdminClient()

type Row = {
  id: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
}

const { data, error } = await db
  .from('documents')
  .select('id, file_name, mime_type, file_size_bytes')
  .is('superseded_at', null)
  .is('excluded_at', null)
  // The unparented queue, and nothing else — see the header.
  .eq('awaiting_filing', true)

if (error) {
  console.error('read failed:', error.message)
  process.exit(1)
}

const rows = (data ?? []) as Row[]
/*
  ⚠ PRINT WHAT WAS EXAMINED. §12: an empty population passes vacuously behind
  the same tick, and a script reading a truncated set is worse than none
  because it is believed. 419 rows is well inside PostgREST's 1000 cap, and
  saying the number is what makes that checkable rather than assumed.
*/
console.log(`examined ${rows.length} unparented document(s)\n`)

const byReason = new Map<SkipReason, Row[]>()
for (const r of rows) {
  const reason = attachmentSkipReason(
    { name: r.file_name, mimeType: r.mime_type ?? '', size: r.file_size_bytes ?? 0 },
    // Every row here is unparented by the WHERE clause above, which is exactly
    // what the orphan path means.
    { toOrphanQueue: true, targets: [] }
  )
  if (!reason) continue
  const list = byReason.get(reason) ?? []
  list.push(r)
  byReason.set(reason, list)
}

let total = 0
let chunksGone = 0
let failed = 0

for (const [reason, list] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${reason} (${list.length}) — ${SKIP_REASON_NOTE[reason]}`)
  for (const r of list) {
    total++
    console.log(`   ${APPLY ? 'set aside' : '   would'}  ${r.file_name.slice(0, 64)}`)
    if (!APPLY) continue
    try {
      const { chunks } = await excludeDocument(
        db,
        r.id,
        // The reason is STORED on the row, so a human reading it later sees
        // which rule took it rather than a bare "excluded".
        `Not imported by the attachment hygiene rules: ${SKIP_REASON_NOTE[reason]}.`,
        'documents'
      )
      chunksGone += chunks
    } catch (err) {
      failed++
      console.error(`   ! ${r.file_name}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log()
}

console.log(
  `${APPLY ? 'set aside' : 'would set aside'} ${total} of ${rows.length}` +
    (APPLY ? `, ${chunksGone} chunk(s) removed, ${failed} failed` : '')
)
console.log(`${rows.length - total} unparented document(s) remain for a human to file.`)
