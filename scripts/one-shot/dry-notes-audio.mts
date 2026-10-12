/** Which notes carry audio, and whether the snapshot has the file. */
import { readNotes } from '@/lib/notes/read'
process.env.NOTES_FOLDER_NAMES = process.env.NOTES_FOLDER_NAMES || 'Notes'
const r = readNotes()
if (r.error) { console.log('ERROR', r.error); process.exit(1) }
const withAudio = r.notes.filter((n) => n.audio.length > 0)
console.log(`notes read: ${r.notes.length}   with audio: ${withAudio.length}`)
for (const n of withAudio) {
  console.log(`\n${n.modifiedAt.slice(0,10)}  ${n.title}   [folder: ${n.folder}]`)
  for (const a of n.audio) console.log(`   ${a.path ? 'ON DISK ' : 'MISSING '} ${a.fileName}  (${a.uti})`)
}
