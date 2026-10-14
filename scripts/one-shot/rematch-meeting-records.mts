/**
 * Re-run the record pre-match over meeting sessions already staged.
 *
 * ⚠ FIXING THE MATCHER CHANGES NOTHING THE READER SEES (§12) — `match_candidates`
 * was written when the session was staged, by the trigram matcher that resolved
 * 5 of 52 named deals. Those nine sessions are sitting in the review queue right
 * now with a blank pre-match on deals the platform holds hundreds of documents
 * for, and re-reading them is what puts the fix in front of a person.
 *
 * Only `pending` sessions. A confirmed one has had its filing decision made by a
 * human, and overwriting the record of what they were SHOWN would be rewriting
 * history for no benefit.
 *
 * No model call — the extraction is already stored; this only re-resolves names.
 * Idempotent: a second run reports nothing.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/one-shot/rematch-meeting-records.mts [--apply]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveMeetingTarget } from '@/lib/meetings/file-notes'
import type { ReferencedMatch } from '@/lib/email-ingestion/analyze-meeting'
import type { JsonIn } from '@/lib/supabase/types'

const apply = process.argv.includes('--apply')
const db = createAdminClient()

const { data: sessions, error } = await db
  .from('email_intake_sessions')
  .select('id, label, status, extraction_result, match_candidates')
  .eq('intake_kind', 'meeting')
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
if (error) throw new Error(error.message)

let touched = 0
let gained = 0
let lost = 0

for (const s of sessions ?? []) {
  const extraction = s.extraction_result as { referenced_records?: { kind: string; name: string }[] } | null
  const refs = extraction?.referenced_records ?? []
  if (refs.length === 0) continue

  const before = new Map<number, ReferencedMatch>()
  for (const m of (s.match_candidates as unknown as ReferencedMatch[]) ?? []) before.set(m.index, m)

  const after: ReferencedMatch[] = []
  const lines: string[] = []
  for (let i = 0; i < refs.length; i++) {
    const res = await resolveMeetingTarget([refs[i].name]).catch(() => null)
    const pick = res?.target ?? res?.suggestion ?? null
    const row: ReferencedMatch = pick
      ? { index: i, matched_id: pick.id, matched_name: pick.name, matched_kind: pick.kind }
      : { index: i, matched_id: null, matched_name: null, matched_kind: null }
    after.push(row)

    const was = before.get(i)?.matched_id ?? null
    if (was === row.matched_id) continue
    if (!was && row.matched_id) {
      gained++
      lines.push(`   + ${refs[i].name}  →  ${row.matched_name} (${row.matched_kind})`)
    } else if (was && !row.matched_id) {
      // Worth printing loudly: the new resolver is stricter about shared words,
      // so a match it drops was probably wrong — but say which, not just how many.
      lost++
      lines.push(`   − ${refs[i].name}  ✗ was ${before.get(i)?.matched_name}`)
    } else {
      lines.push(`   ~ ${refs[i].name}  →  ${row.matched_name} (was ${before.get(i)?.matched_name})`)
    }
  }

  if (lines.length === 0) continue
  touched++
  console.log(`\n${String(s.label).slice(0, 58)}`)
  for (const l of lines) console.log(l)

  if (!apply) continue
  const { error: upErr } = await db
    .from('email_intake_sessions')
    .update({ match_candidates: after as unknown as JsonIn })
    .eq('id', s.id)
  if (upErr) console.error(`   ! ${upErr.message}`)
}

console.log(
  `\n${touched} session(s): ${gained} new match(es), ${lost} dropped${apply ? ' — applied' : ' — dry run, pass --apply'}`
)
