/**
 * Fill `content_sha256` for every document that has none.
 *
 * Until 2026-10-09 only the email-attachment importer wrote this column, so of
 * 651 live documents just 103 carried a hash. That single gap is the whole
 * duplicate problem: the attachment importer dedupes on the hash and could not
 * see one Drive-imported document, so it collided on the NAME instead and
 * `disambiguateName` appended the email subject — the signature on 37 of the 185
 * near-identical pairs measured that day. Both Drive importers write the hash
 * now; this is the catch-up for everything already stored.
 *
 * FILL ONLY, NEVER OVERWRITE. A stored hash is a fact about bytes that do not
 * change, so there is nothing here a second opinion could improve — and the one
 * way this pass could do damage is by rewriting a hash the deduper has already
 * acted on. Rows that already have one are not even read.
 *
 * Covers `documents` AND `opportunity_documents`: a file can live in either, so
 * "do we already hold these bytes" is always two questions, and a backfill that
 * answers one of them leaves the other half of the corpus undeduplicable.
 *
 * Run:  node --experimental-strip-types --import ./deploy/register.mjs \
 *            --env-file=.env.local scripts/backfill-document-hashes.mts
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { hashDocumentBytes } from '@/lib/documents/dedupe'

const admin = createAdminClient()
const PAGE = 500

type Table = 'documents' | 'opportunity_documents'

interface Row {
  id: string
  file_name: string | null
  storage_path: string | null
}

async function backfill(table: Table): Promise<void> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select('id, file_name, storage_path')
      .is('content_sha256', null)
      .range(from, from + PAGE - 1)
    // ⚠ A zero from a broken query and a zero from an empty table are the same
    // number on screen. Refuse rather than report "nothing to do".
    if (error) throw new Error(`${table}: could not list rows — ${error.message}`)
    const page = (data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE) break
  }

  console.log(`${table}: ${rows.length} row(s) with no hash.`)

  let hashed = 0
  /** WHY each row could not be hashed, counted — an unlabelled skip count is not a signal. */
  const skipped: Record<string, number> = {}
  const note = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const row of rows) {
    if (!row.storage_path) {
      note('no storage_path on the row')
      continue
    }
    const { data: blob, error } = await admin.storage.from('documents').download(row.storage_path)
    if (error || !blob) {
      note(`storage object missing or unreadable (${error?.message ?? 'no body'})`)
      continue
    }
    const digest = hashDocumentBytes(await blob.arrayBuffer())
    const { error: upErr } = await admin
      .from(table)
      .update({ content_sha256: digest })
      .eq('id', row.id)
      // Fill only. If another pass hashed this row since the listing, theirs stands.
      .is('content_sha256', null)
    if (upErr) {
      note(`could not store the hash (${upErr.message})`)
      continue
    }
    hashed++
    if (hashed % 50 === 0) console.log(`  …${hashed} hashed`)
  }

  console.log(`${table}: hashed ${hashed}, skipped ${Object.values(skipped).reduce((a, b) => a + b, 0)}.`)
  for (const [reason, n] of Object.entries(skipped)) console.log(`   ${n} × ${reason}`)
}

await backfill('documents')
await backfill('opportunity_documents')

// What the corpus looks like afterwards, so the run proves its own result rather
// than asserting it.
for (const table of ['documents', 'opportunity_documents'] as Table[]) {
  const { count: total } = await admin.from(table).select('id', { count: 'exact', head: true })
  const { count: withHash } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .not('content_sha256', 'is', null)
  console.log(`\n${table}: ${withHash ?? 0} of ${total ?? 0} rows now carry a content hash.`)
}
