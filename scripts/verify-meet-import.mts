#!/usr/bin/env node
/**
 * Would the Meet importer find anything, and where would it file it?
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-meet-import.mts
 *
 * Read-only, and costs no model passes. Creates nothing, stages nothing.
 *
 * This exists because the failure it diagnoses is invisible from the outside.
 * The importer ran 192 times reporting `noMeetFolder` against a Drive that had
 * one — under a name the code did not know — and a run that finds nothing looks
 * exactly like a week with no meetings. A coverage count cannot tell those apart
 * (§12), so this prints the intermediate steps instead of the total:
 *
 *   1. which folder resolved, per mailbox, and by which name
 *   2. which documents in it the importer would accept
 *   3. the title recovered from each file name
 *   4. the record each title resolves to — or why it refuses
 *
 * Run it after any Meet/Drive change, and whenever the cron reports 0 imported.
 */

import {
  listMeetTranscripts,
  fetchDriveFile,
  MEET_FOLDER_NAMES,
} from '@/lib/integrations/google-drive'
import { MAILBOXES, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { meetingTitleFromFileName, meetingTargetFromTitle } from '@/lib/meetings/meet-import'
import { resolveMeetingTarget } from '@/lib/meetings/file-notes'
import { splitGeminiNotes } from '@/lib/meetings/gemini-notes'

if (!isGoogleConfigured()) {
  console.error('Google Workspace is not configured — nothing to check.')
  process.exit(1)
}

console.log(`Looking for a Meet folder named ${MEET_FOLDER_NAMES.map((n) => `"${n}"`).join(' or ')}`)
console.log(`(override with GOOGLE_MEET_FOLDER_ID)\n`)

let totalDocs = 0
let totalFilable = 0

for (const mailbox of MAILBOXES) {
  const a = await listMeetTranscripts(mailbox, { limit: 50 })

  if (a.noMeetFolder) {
    console.log(`${mailbox}: NO MEET FOLDER. Meet files nothing here, or files it elsewhere.`)
    continue
  }

  console.log(`${mailbox}: ${a.transcripts.length} document(s) the importer would take` +
    (a.recordingsWithoutTranscript
      ? `, ${a.recordingsWithoutTranscript} recording(s) with no notes beside them`
      : ''))

  for (const file of a.transcripts) {
    totalDocs++
    const title = meetingTitleFromFileName(file.name)
    const candidates = meetingTargetFromTitle(title)
    const { target, ambiguous } = await resolveMeetingTarget(candidates)

    console.log(`\n  ${file.name}`)
    console.log(`    title      ${JSON.stringify(title)}`)
    console.log(`    candidates ${candidates.join(' → ')}`)

    // Fetch and split, so a format change at Google's end shows up here rather
    // than as a run that silently calls every meeting "too short".
    const content = await fetchDriveFile(file, { mailbox }).catch(() => null)
    if (!content) {
      console.log(`    ⚠ Drive returned nothing for this file.`)
      continue
    }
    const { notes, transcript } = splitGeminiNotes(
      Buffer.from(content.buffer).toString('utf-8')
    )
    console.log(
      `    content    recap ${notes.length} chars, transcript ${transcript?.length ?? 0} chars`
    )
    if (!transcript) console.log(`    ⚠ no transcript section — transcription may be off`)

    if (target) {
      totalFilable++
      console.log(`    FILES TO   ${target.kind}: ${target.name}`)
    } else if (ambiguous) {
      console.log(`    REFUSES    ${ambiguous}`)
    } else {
      console.log(`    NO MATCH   goes to the review queue for manual filing`)
    }
  }
  console.log()
}

console.log(
  `\n${totalDocs} document(s) visible; ${totalFilable} would file themselves, ` +
    `${totalDocs - totalFilable} would wait for a human to pick the record.`
)
