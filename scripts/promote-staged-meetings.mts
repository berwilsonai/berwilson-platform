/**
 * Run the 10-19 promotion gate over meetings ALREADY staged.
 *
 * The gate runs inside each recording sweep and inside the Meet importer, which
 * means it only ever sees a call that arrives AFTER it shipped. Everything
 * already on file — six Gemini-noted Meet calls, the voice memos — was recapped
 * before the gate existed, and its `extraction_result` is sitting in
 * `email_intake_sessions` with the per-deal `discussion` paragraphs and dated
 * tasks the gate reads. So this is a catch-up over data already paid for: no
 * model call, no Drive read, no transcription.
 *
 * ⚠ DRY RUN BY DEFAULT, and the dry run is the point. A backfill is the one
 * shape of this pass that can create several records and send one text about
 * all of them, so the first run prints exactly what it would do.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/promote-staged-meetings.mts
 *   …and again with --apply to write.
 *
 * `--quiet-texts` applies the records without texting, for a catch-up where
 * the news is weeks old and a phone buzzing about it is noise.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { promoteRecordingRecords } from '@/lib/records/from-recording'
import { composeRecordAlert, sendRecordAlert } from '@/lib/pepper/record-alert'
import { localDateString } from '@/lib/meetings/record-local'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'

const APPLY = process.argv.includes('--apply')
const QUIET = process.argv.includes('--quiet-texts')

interface SessionRow {
  id: string
  drive_file_id: string | null
  source_title: string | null
  created_at: string | null
  status: string | null
  extraction_result: unknown
}

function asExtraction(value: unknown): MeetingIntakeExtraction | null {
  if (!value || typeof value !== 'object') return null
  const e = value as Partial<MeetingIntakeExtraction>
  // A recap with no referenced records has nothing for the gate to consider,
  // which is a legitimate answer and not a malformed row.
  if (!Array.isArray(e.referenced_records)) return null
  return value as MeetingIntakeExtraction
}

const supabase = createAdminClient()

const { data, error } = await supabase
  .from('email_intake_sessions')
  .select('id, drive_file_id, source_title, created_at, status, extraction_result')
  .eq('intake_kind', 'meeting')
  .not('extraction_result', 'is', null)
  .order('created_at', { ascending: false })
  .limit(200)

if (error) {
  console.error('could not read the staged meetings:', error.message)
  process.exitCode = 1
} else {
  const rows = (data ?? []) as SessionRow[]
  console.log(
    `\n${rows.length} staged meeting(s) with a recap${APPLY ? '' : ' — DRY RUN, nothing will be written'}\n`
  )

  const allCreated: Awaited<ReturnType<typeof promoteRecordingRecords>>['created'] = []
  let considered = 0
  const refusals = new Map<string, number>()

  for (const row of rows) {
    const extraction = asExtraction(row.extraction_result)
    if (!extraction) continue
    const refs = extraction.referenced_records ?? []
    if (refs.length === 0) continue

    // ⚠ NO `drive_file_id` MEANS NO UNDO HANDLE, so it is skipped rather than
    // created without one. Every automatic record has to be retirable as a set.
    if (!row.drive_file_id) {
      console.log(`· ${row.source_title ?? row.id}: no source ref, skipped (nothing to undo it by)`)
      continue
    }

    considered++
    const recordedOn =
      extraction.meeting_date ?? localDateString(row.created_at ?? new Date().toISOString())

    const res = await promoteRecordingRecords({
      extraction,
      sourceRef: row.drive_file_id,
      recordedOn,
      // No calendar read: a months-old call's follow-up is not on today's
      // calendar, so the fact would be absent for a reason that is about the
      // clock rather than the deal.
      mailboxes: [],
      dryRun: !APPLY,
    })

    const title = (row.source_title ?? row.id).slice(0, 60)
    if (res.created.length > 0) {
      console.log(`\n▸ ${title}  (${recordedOn})`)
      for (const c of res.created) {
        console.log(`    + ${c.kind}: ${c.name}${c.oppType ? ` [${c.oppType}]` : ''}`)
        console.log(`      gate: ${c.fact.kind} — ${c.fact.detail}`)
        console.log(`      tldr: ${c.tldr}`)
        console.log(`      next: ${c.nextStep ?? '(none stated)'}`)
      }
      allCreated.push(...res.created)
    }
    for (const s of res.skipped) {
      const key = s.why.replace(/".*?"/g, '"…"').slice(0, 70)
      refusals.set(key, (refusals.get(key) ?? 0) + 1)
    }
  }

  console.log(`\n── ${considered} meeting(s) named at least one deal ──`)
  console.log(`${allCreated.length} record(s) ${APPLY ? 'created' : 'would be created'}\n`)
  console.log('Refused, by reason:')
  for (const [why, n] of [...refusals].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} × ${why}`)
  }

  if (allCreated.length > 0) {
    console.log('\nThe text that would go out:\n')
    console.log(
      composeRecordAlert(allCreated, { recordedOn: null })
        .split('\n')
        .map((l) => `    │ ${l}`)
        .join('\n')
    )
    if (APPLY && !QUIET) {
      const alert = await sendRecordAlert({ created: allCreated })
      console.log(`\nsent=${alert.sent} failed=${alert.failed} skipped=${alert.skipped}`)
      for (const n of alert.notes) console.log(`  · ${n}`)
    } else if (APPLY) {
      console.log('\n--quiet-texts: the records were written and nothing was sent.')
    }
  }

  console.log(
    APPLY
      ? '\nDone. Undo a run with: delete from projects/opportunities where auto_created_from = <ref>\n'
      : '\nDry run. Re-run with --apply to write (add --quiet-texts to skip the text).\n'
  )
}
