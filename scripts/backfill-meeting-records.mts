/**
 * Backfill the meeting records and transcript filings for calls already imported.
 *
 * WHY A BACKFILL IS NEEDED AT ALL. The Meet importer is idempotent on
 * `drive_file_id`, so the five transcripts already staged will never be
 * reprocessed — they report `alreadyImported` forever. Every one of the fixes
 * shipped today therefore applies only to the NEXT meeting unless this runs:
 *
 *   - 3 of the 5 were filed nowhere (the title matched no record name), so
 *     their text is in no document, no chunk, and no answer Ber AI can give.
 *     That includes the Tensor call of 2026-10-07, recorded the day before this
 *     was written.
 *   - 0 of the 5 have a row in `meetings`, which is the table `search_meetings`
 *     and `get_meeting_content` read. Ask about any of them by name and the
 *     agent's meeting tools answer nothing.
 *
 * Idempotent, and deliberately verifiable as such: run it twice and the second
 * run must report nothing done (§12 — a pass that reports what it did must read
 * before it writes, or it claims work it did not do). Pass `--check` to read
 * without writing.
 *
 * Usage (from the repo root, on the Studio):
 *   node --experimental-strip-types --import ./scripts/register-alias.mjs \
 *        --env-file=.env.local scripts/backfill-meeting-records.mts [--check]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { upsertMeetingFromImport, linkDocumentToMeeting } from '@/lib/meetings/record'
import {
  resolveMeetingTarget,
  fileMeetingDocument,
  findFiledTranscript,
  type FileTarget,
} from '@/lib/meetings/file-notes'
import { meetingTargetFromTitle } from '@/lib/meetings/meet-import'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'

const check = process.argv.includes('--check')

async function main() {
  const supabase = createAdminClient()

  const { data: sessions, error } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, raw_text, extraction_result, drive_file_id, created_at')
    .eq('intake_kind', 'meeting')
    .not('drive_file_id', 'is', null)
    .order('created_at', { ascending: true })
  // ⚠ Checked, not assumed. A zero from a broken query and a zero from an empty
  // table are the same number on screen (§12).
  if (error) throw new Error(`could not read meeting sessions: ${error.message}`)

  const rows = sessions ?? []
  console.log(`${rows.length} imported meeting session(s) on file.\n`)

  let meetingsCreated = 0
  let documentsFiled = 0
  let alreadyComplete = 0
  const skipped: string[] = []

  for (const s of rows) {
    const driveFileId = s.drive_file_id as string
    const extraction = (s.extraction_result ?? {}) as Partial<MeetingIntakeExtraction>
    const title = extraction.title || s.label || 'Recorded meeting'
    const meetingDate =
      extraction.meeting_date || String(s.created_at ?? '').slice(0, 10) || null

    if (!meetingDate) {
      skipped.push(`${title}: no meeting date could be determined`)
      continue
    }

    // What already exists, read before anything is written.
    const { data: existingMeeting } = await supabase
      .from('meetings')
      .select('id, scope, project_id, opportunity_id')
      .eq('drive_file_id', driveFileId)
      .maybeSingle()
    const existingDoc = await findFiledTranscript(supabase, driveFileId)

    // ⚠ AN EXISTING FILING OUTRANKS THE TITLE. Two of these transcripts are
    // already sitting on the Elite Solutions opportunity, filed by the importer
    // back when the title happened to match — so the meeting they describe
    // belongs to that opportunity as a FACT, and re-deriving it from a name
    // match would be guessing at something already known.
    const resolution = await resolveMeetingTarget(meetingTargetFromTitle(title)).catch(() => ({
      target: null,
      suggestion: null,
      ambiguous: null,
      via: null,
    }))
    let target = resolution.target
    let via: string | null = resolution.via
    if (
      existingDoc?.recordId &&
      (existingDoc.shelf === 'project' || existingDoc.shelf === 'opportunity')
    ) {
      const table = existingDoc.shelf === 'project' ? 'projects' : 'opportunities'
      const { data: owner } = await supabase
        .from(table)
        .select('id, name')
        .eq('id', existingDoc.recordId)
        .maybeSingle()
      if (owner) {
        target = { kind: existingDoc.shelf, id: owner.id, name: owner.name }
        via = 'existing filing'
      }
    }

    const needsMeeting = !existingMeeting
    const needsDoc = !existingDoc

    if (!needsMeeting && !needsDoc) {
      alreadyComplete++
      console.log(`· ${title}\n    already has both a meeting record and a filed transcript`)
      continue
    }

    console.log(`· ${title}  (${meetingDate})`)
    if (via) console.log(`    resolves via ${via}: ${target?.name ?? resolution.suggestion?.name}`)
    else if (resolution.ambiguous) console.log(`    title is ambiguous — ${resolution.ambiguous}`)
    else console.log(`    title matches no record`)

    if (check) {
      if (needsMeeting) console.log('    WOULD create the meeting record')
      if (needsDoc) console.log(`    WOULD file the transcript on ${target ? `${target.kind} ${target.name}` : 'the reference shelf'}`)
      continue
    }

    let meetingId = existingMeeting?.id ?? null
    if (needsMeeting) {
      const created = await upsertMeetingFromImport({
        title,
        meetingDate,
        summary: extraction.summary || null,
        minutes: extraction.minutes ?? null,
        decisions: extraction.decisions ?? [],
        attendees: extraction.attendees ?? [],
        transcript: typeof s.raw_text === 'string' ? s.raw_text : null,
        driveFileId,
        target,
      })
      if (created) {
        meetingId = created.id
        if (created.created) {
          meetingsCreated++
          console.log(`    created the meeting record (scope=${created.scope})`)
        }
      } else {
        skipped.push(`${title}: the meeting record could not be created`)
      }
    }

    if (needsDoc) {
      const raw = typeof s.raw_text === 'string' ? s.raw_text : ''
      if (!raw.trim()) {
        skipped.push(`${title}: the session holds no transcript text to file`)
      } else {
        const fileTarget: FileTarget = target
          ? { kind: target.kind, id: target.id, name: target.name }
          : { kind: 'reference', id: 'reference', name: title }
        const filed = await fileMeetingDocument({
          target: fileTarget,
          driveFileId,
          title,
          content: raw,
          summary: extraction.summary ?? null,
          meetingDate,
        })
        if (filed && !filed.alreadyFiled) {
          documentsFiled++
          console.log(`    filed + indexed the transcript on the ${filed.shelf} shelf`)
          if (meetingId && filed.shelf !== 'opportunity') {
            await linkDocumentToMeeting(supabase, filed.documentId, meetingId)
          }
        } else if (filed) {
          console.log(`    transcript was already filed on the ${filed.shelf} shelf`)
        } else {
          skipped.push(`${title}: the transcript could not be filed`)
        }
      }
    }
  }

  console.log('')
  console.log(check ? '— dry run, nothing written —' : '— done —')
  console.log(`meeting records created: ${meetingsCreated}`)
  console.log(`transcripts filed:      ${documentsFiled}`)
  console.log(`already complete:       ${alreadyComplete}`)
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`)
    for (const line of skipped) console.log(`  - ${line}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
