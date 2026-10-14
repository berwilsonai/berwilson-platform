/**
 * Re-run the recap over meeting sessions staged under an older prompt version.
 *
 * ⚠ FIXING THE PROMPT CHANGES NOTHING ALREADY STAGED (§12), and here that is the
 * whole queue. Prompt 1.2 (2026-10-14) added `discussion` — what the call said
 * about EACH deal — and the confirm step writes that to the record instead of
 * the whole call's minutes. A session extracted under 1.1 carries no such field,
 * so it falls back to the old behaviour: every deal the call touched gets the
 * whole narrative. Correct, documented, tested — and not what the reviewer asked
 * for. The nine sessions in the queue would each confirm the old way.
 *
 * ⚠ IT RE-WRITES THE MODEL'S OUTPUT, AND ONLY THE MODEL'S. `extraction_result`
 * is pristine model output — the review screen reads it, the reviewer's edits
 * live in the browser and arrive in the confirm BODY, never back on this row —
 * so a pending session can be re-extracted without discarding anybody's work.
 * `status='pending'` only, for the same reason the re-matcher is: a confirmed
 * session is the record of what a human was shown.
 *
 * ⚠ AND THE RECAP WILL READ DIFFERENTLY AFTERWARDS. The model is not
 * deterministic: titles, minutes and the task list all come back slightly
 * changed. That is the cost, it is why this is a one-shot and not a cron, and it
 * is why the dry run prints the before and after of each session's shape.
 *
 * One local-model pass per session, ~2 minutes each on this box, sequential
 * because LM Studio serves one request at a time (§12).
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/one-shot/reextract-meeting-sessions.mts [--apply] [--only <id>]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { extractMeeting } from '@/lib/email-ingestion/analyze-meeting'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { resolveMeetingTarget } from '@/lib/meetings/file-notes'
import { MEETING_INTAKE_PROMPT_VERSION } from '@/lib/ai/prompts/meeting-intake'
import type { ReferencedMatch } from '@/lib/email-ingestion/analyze-meeting'
import type { JsonIn } from '@/lib/supabase/types'

const apply = process.argv.includes('--apply')
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

const db = createAdminClient()

let q = db
  .from('email_intake_sessions')
  .select('id, label, raw_text, extraction_result, created_at')
  .eq('intake_kind', 'meeting')
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
if (only) q = q.eq('id', only)

const { data: sessions, error } = await q
if (error) throw new Error(error.message)

console.log(`prompt version now: ${MEETING_INTAKE_PROMPT_VERSION}`)
console.log(`${sessions?.length ?? 0} pending meeting session(s)\n`)

let done = 0
let skipped = 0

for (const s of sessions ?? []) {
  const old = s.extraction_result as {
    title?: string | null
    referenced_records?: { name: string; discussion?: string | null }[]
    tasks?: unknown[]
  } | null
  const oldRefs = old?.referenced_records ?? []

  // Already carries per-deal text? Nothing to do — this is what makes the
  // script safe to re-run and what proves a second pass reports nothing.
  if (oldRefs.length > 0 && oldRefs.some((r) => typeof r.discussion === 'string' && r.discussion.trim())) {
    skipped++
    continue
  }
  if (!s.raw_text || s.raw_text.length < 400) {
    console.log(`— ${String(s.label).slice(0, 50)}: no transcript to re-read`)
    skipped++
    continue
  }

  const t0 = Date.now()
  let next
  try {
    next = await extractMeeting({
      rawText: s.raw_text,
      title: old?.title ?? null,
      meetingDate: null,
      userId: SYSTEM_USER_ID,
    })
  } catch (err) {
    console.log(`! ${String(s.label).slice(0, 50)}: ${err instanceof Error ? err.message : String(err)}`)
    continue
  }

  const withText = next.referenced_records.filter((r) => r.discussion?.trim()).length
  console.log(
    `${String(s.label).slice(0, 50)}\n` +
      `   ${((Date.now() - t0) / 1000).toFixed(0)}s | records ${oldRefs.length} → ${next.referenced_records.length}` +
      ` (${withText} with their own paragraph, ${next.referenced_records.length - withText} mentioned only)` +
      ` | tasks ${old?.tasks?.length ?? 0} → ${next.tasks.length}`
  )
  for (const r of next.referenced_records) {
    console.log(`     ${r.discussion?.trim() ? '✓' : '·'} ${r.name}`)
  }

  if (!apply) continue

  // Re-match in the same pass: the names changed, so the old `match_candidates`
  // are aligned to referenced_records BY INDEX and would now point at the wrong
  // rows. Stale indices are worse than none — the review screen would open with
  // one deal's record ticked against another deal's name.
  const matches: ReferencedMatch[] = []
  for (let i = 0; i < next.referenced_records.length; i++) {
    const res = await resolveMeetingTarget([next.referenced_records[i].name]).catch(() => null)
    const pick = res?.target ?? res?.suggestion ?? null
    matches.push(
      pick
        ? { index: i, matched_id: pick.id, matched_name: pick.name, matched_kind: pick.kind }
        : { index: i, matched_id: null, matched_name: null, matched_kind: null }
    )
  }

  const { error: upErr } = await db
    .from('email_intake_sessions')
    .update({
      extraction_result: next as unknown as JsonIn,
      match_candidates: matches as unknown as JsonIn,
      label: next.title ?? s.label,
    })
    .eq('id', s.id)
  if (upErr) console.log(`   ! ${upErr.message}`)
  else done++
}

console.log(
  `\n${done} re-extracted, ${skipped} skipped (already current or no transcript)` +
    (apply ? '' : ' — dry run, pass --apply')
)
