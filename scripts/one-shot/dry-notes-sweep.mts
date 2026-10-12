/** Dry run of the Notes sweep. Reads, refuses, writes nothing. */
import { runNotesSweep } from '@/lib/notes/sweep'
const r = await runNotesSweep({ dryRun: true })
console.log(JSON.stringify({ ok: r.ok, nominated: r.nominated, foldersSeen: r.foldersSeen, found: r.found,
  refusedCount: r.refused.length, undecodable: r.undecodable, withUnreadableAttachments: r.withUnreadableAttachments,
  calls: r.calls, error: r.error }, null, 2))
for (const f of r.refused) console.log(`  REFUSED  ${f.title}  [${f.reason}]`)
for (const n of r.notes) console.log(`  ${n}`)
