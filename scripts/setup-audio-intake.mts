/**
 * Create (or find) the Drive folder recordings are dropped into, and print the
 * one line that turns the sweep on.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/setup-audio-intake.mts [--name "…"]
 *
 * Idempotent: `ensureFolder` finds an existing folder of that name before it
 * creates one, so running this twice prints the same id.
 *
 * ⚠ IT PUTS THE FOLDER ON THE SHARED DRIVE, NOT IN A PERSONAL MY DRIVE. The
 * team's documents live on "Ber Wilson Proper" (there is exactly one shared
 * drive on this account), which means either executive can drop a recording
 * from any device and the sweep — which reads as moose@ — can see all of them.
 * A folder in one person's My Drive would be invisible to the other.
 *
 * ⚠ IT DOES NOT WRITE `.env.local`. That file holds every secret the platform
 * has and two Claude sessions share this repo; a script editing it is how a
 * key gets clobbered. It prints the line to paste.
 */

import { ensureFolder } from '@/lib/integrations/google-drive-write'
import { listSharedDrives } from '@/lib/integrations/google-drive'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import { driveAudioFolderId } from '@/lib/driveaudio/read'

const nameArg = process.argv.indexOf('--name')
const FOLDER_NAME = nameArg > -1 ? process.argv[nameArg + 1] : 'Ber AI Recordings'

const existing = driveAudioFolderId()
if (existing) {
  console.log(`GOOGLE_AUDIO_INTAKE_FOLDER_ID is already set to ${existing}.`)
  console.log('Nothing to do — delete that line first if you want to point it somewhere else.')
  process.exit(0)
}

const drives = await listSharedDrives(PRIMARY_MAILBOX)
if (drives.length === 0) {
  console.error(
    `No shared drive is visible to ${PRIMARY_MAILBOX}. Create the folder by hand in Drive, ` +
      `then put its id (the last path segment of its URL) in .env.local.`
  )
  process.exit(1)
}
const drive = drives[0]

const folder = await ensureFolder(FOLDER_NAME, drive.id, PRIMARY_MAILBOX)

console.log(`Folder: "${FOLDER_NAME}" on the "${drive.name}" shared drive`)
console.log(`Open:   ${folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`}`)
console.log('')
console.log('Add this to .env.local, then rebuild and restart:')
console.log('')
console.log(`GOOGLE_AUDIO_INTAKE_FOLDER_ID=${folder.id}`)
console.log('')
console.log('Then check what it would read, without transcribing anything:')
console.log('')
console.log(
  '  curl -sS -H "Authorization: Bearer $(grep \'^CRON_SECRET=\' .env.local | cut -d= -f2-)" \\\n' +
    "    'http://localhost:3000/api/cron/drive-audio-sweep?dry=1' | python3 -m json.tool"
)
