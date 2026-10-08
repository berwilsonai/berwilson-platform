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
import { meetingTargetFromTitle, meetingTitleFromFileName } from '@/lib/meetings/meet-import'
import { listMeetTranscripts } from '@/lib/integrations/google-drive'
import { MAILBOXES } from '@/lib/integrations/google-workspace'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'

const check = process.argv.includes('--check')

async function main() {
  const supabase = createAdminClient()

  // ── The invitation titles, recovered from Drive ────────────────────────────
  //
  // ⚠ WITHOUT THIS STEP THE BACKFILL RESOLVES THE WRONG TITLE, which is how the
  // bug was found. The model rewrites these: Drive holds
  // "Ber Wilson / Zenthium" and the session's own label says "Steelton &
  // Riverdale Site Reviews & Power Capacity Analysis". Only the first can match
  // a record (`Zenthium Partnership`) or be learned as a key the NEXT call will
  // present. `source_title` now stores it at import; these five pre-date the
  // column, so it is read back off the file name.
  const invitationTitles = new Map<string, string>()
  for (const mailbox of MAILBOXES) {
    try {
      const listed = await listMeetTranscripts(mailbox, { limit: 200 })
      for (const f of listed.transcripts) {
        invitationTitles.set(f.id, meetingTitleFromFileName(f.name))
      }
    } catch (err) {
      // Non-fatal, but say so: without it the titles fall back to the model's
      // rewrite and the resolutions below are worth less than they look.
      console.error(`! could not list ${mailbox}'s Meet folder — titles for its meetings fall back to the model's rewrite:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`${invitationTitles.size} invitation title(s) recovered from Drive.`)

  const { data: sessions, error } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, raw_text, extraction_result, drive_file_id, source_title, created_at')
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
  let sourceTitlesStored = 0
  let alreadyComplete = 0
  const skipped: string[] = []

  for (const s of rows) {
    const driveFileId = s.drive_file_id as string
    const extraction = (s.extraction_result ?? {}) as Partial<MeetingIntakeExtraction>
    // Two titles, two jobs (§ migration 20261008000004): the READING title is
    // the model's, the FILING title is the organizer's.
    const title = extraction.title || s.label || 'Recorded meeting'
    const filingTitle =
      s.source_title || invitationTitles.get(driveFileId) || title
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
    const resolution = await resolveMeetingTarget(meetingTargetFromTitle(filingTitle)).catch(() => ({
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

    // Backfilled whether or not anything else is needed: a session that is
    // otherwise complete still has to carry the key its own confirm will learn.
    const recovered = invitationTitles.get(driveFileId)
    if (!s.source_title && recovered && !check) {
      const { error: stErr } = await supabase
        .from('email_intake_sessions')
        .update({ source_title: recovered })
        .eq('id', s.id)
      if (stErr) skipped.push(`${title}: source_title could not be stored — ${stErr.message}`)
      else sourceTitlesStored++
    } else if (!s.source_title && recovered && check) {
      console.log(`· ${title}\n    WOULD store the invitation title "${recovered}"`)
    }

    if (!needsMeeting && !needsDoc) {
      alreadyComplete++
      console.log(`· ${title}\n    already has both a meeting record and a filed transcript`)
      if (filingTitle !== title) console.log(`    invitation title: "${filingTitle}"`)
      if (via) console.log(`    resolves via ${via}: ${target?.name ?? resolution.suggestion?.name}`)
      else if (resolution.suggestion) console.log(`    closest record: ${resolution.suggestion.name} (a suggestion, not filed on)`)
      continue
    }

    console.log(`· ${title}  (${meetingDate})`)
    if (filingTitle !== title) console.log(`    invitation title: "${filingTitle}"`)
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
  console.log(`invitation titles kept: ${sourceTitlesStored}`)
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`)
    for (const line of skipped) console.log(`  - ${line}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
