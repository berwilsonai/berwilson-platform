/**
 * Dry run: what does the unfiled-documents queue actually propose?
 *
 * Read-only. Prints every candidate with its proposed home, the reason, and
 * how many chunks it accounts for, so the matcher can be judged against the
 * real corpus before a filing decision is ever offered on screen (§12).
 */
import { findMisfiledCompanyDocuments } from '../src/lib/documents/unfiled.ts'

const items = await findMisfiledCompanyDocuments()

const matched = items.filter((i) => i.target)
const notKnowledge = items.filter((i) => !i.target)

console.log(`\n${items.length} candidates — ${matched.length} with a proposed home, ${notKnowledge.length} not documents\n`)

console.log('=== PROPOSED HOMES ===')
for (const i of matched) {
  console.log(
    `${String(i.chunks).padStart(4)} chunks  ${i.target!.kind.padEnd(11)} ${i.target!.name.slice(0, 44).padEnd(44)} ← ${i.fileName.slice(0, 52)}`
  )
  console.log(`              why: ${i.reason} (${i.confidence?.toFixed(2)})   folder: ${i.folderPath ?? '(none)'}`)
}

console.log('\n=== NOT DOCUMENTS ===')
for (const i of notKnowledge) {
  console.log(`${String(i.chunks).padStart(4)} chunks  ${i.fileName.slice(0, 60).padEnd(60)} ${i.reason}`)
}

const totalChunks = items.reduce((s, i) => s + i.chunks, 0)
console.log(`\n${totalChunks} chunks would leave the company corpus.`)
