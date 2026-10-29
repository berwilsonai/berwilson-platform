import { test } from 'node:test'
import assert from 'node:assert/strict'

import { planAutoFile } from './autofile'

/**
 * The bar for filing a document without being asked.
 *
 * Every case here is a real row from the live corpus on 2026-10-29, including
 * the two that must be REFUSED. §12: measure the rule against the real corpus
 * before building it — and the refusals are the half worth keeping, because an
 * auto-file that is wrong is a document answering for the wrong deal until
 * somebody notices.
 */

type Doc = Parameters<typeof planAutoFile>[0][number]

const doc = (fileName: string, targetName: string, folderPath: string | null = null): Doc => ({
  id: fileName,
  fileName,
  folderPath,
  docType: null,
  target: { kind: 'opportunity', id: `id-${targetName}`, name: targetName },
})

const filed = (docs: Doc[]) => planAutoFile(docs, 'unparented').file.map((d) => d.fileName)

test('a document carrying the record whole name files itself', () => {
  const rows = [
    doc('GridEdge_DC_Investor_Deck bp 4.0.pdf', 'GridEdge'),
    doc('Alaska_Strategic_Materials_JV_Brief_2026-09-13.pdf', 'Alaska Strategic Materials JV'),
    doc('Dino_Plumbing_LOI_Redline_4.docx', 'Dino Plumbing'),
    doc('West Wendover Mayor City Council Letter.pdf', 'West Wendover'),
  ]
  assert.equal(filed(rows).length, 4)
})

test('the Drive folder counts — it is often the only place the deal is named', () => {
  // §12: a container a human filed into is an ASSERTION, not a description.
  const rows = [doc('Business Plan.docx', 'GridEdge', 'Corporate /M & A/GridEdge Modular Datacenter')]
  assert.deepEqual(filed(rows), ['Business Plan.docx'])
})

test('⚠ A COUNTERPARTY WORD NEVER FILES — the recorded Tensor failure', () => {
  /*
    The live alias "Tensor CM" tokenizes to the single token `tensor`, because
    `tokenize()` drops anything two characters or shorter. `matchDocument`
    therefore proposes this document for *Tensor Site Construction Management*
    with `certainty: 'linked'` — a FACT outranking every similarity score.

    It is the §12 failure verbatim: *one `Tensor MNDA` 'proving' four unrelated
    sites on the counterparty word alone*. The whole-name bar refuses it,
    because "tensor site construction management" is not contiguously inside the
    file name, and that is the entire reason this pass does not act on aliases.
  */
  const rows = [
    doc('Tensor MNDA (with Non-Circumvention).docx', 'Tensor Site Construction Management'),
    doc('Tensor IQ LLC - Bio Jonathan Houk.pdf', 'Tensor Site Construction Management'),
    doc('Tensor IQ - Update October 101426.pdf', 'Tensor Site Construction Management'),
  ]
  assert.deepEqual(filed(rows), [], 'a counterparty-wide document must not file onto one engagement')
})

test('⚠ A DOCUMENT NAMING ANOTHER PLACE NEVER FILES — the Quantum Campus case', () => {
  // `Doc2_Myton_Quantum_Campus_MOU_Updated.docx` is proposed for *Box Elder
  // Quantum Campus* on its asserted alias "Quantum Campus". The document's own
  // name says MYTON. CLAUDE.md §13 already flags this alias as suspicious after
  // a Helper, Utah recording landed on Box Elder the same way.
  const rows = [doc('Doc2_Myton_Quantum_Campus_MOU_Updated.docx', 'Box Elder Quantum Campus')]
  assert.deepEqual(filed(rows), [])
})

test('two distinctive shared words are not enough on their own', () => {
  // The matcher offers these; this pass does not take them. §12 measured the
  // two-word gate at 9 wrong records out of 9.
  const rows = [doc('Myton Rail Corridor Study.pdf', 'Myton Development')]
  assert.deepEqual(filed(rows), [])
})

test('a row the matcher proposed nothing for is not counted as held', () => {
  // Held means "offered and refused by this bar". Counting un-proposed rows
  // would inflate the number into something the report does not mean (§12 —
  // one quantity, one definition).
  const { file, held } = planAutoFile(
    [{ id: 'x', fileName: 'Package.pdf', folderPath: null, docType: null, target: null }],
    'unparented'
  )
  assert.deepEqual(file, [])
  assert.equal(held, 0)
})

test('held counts every proposal this bar declined', () => {
  const { held } = planAutoFile(
    [
      doc('Tensor MNDA.docx', 'Tensor Site Construction Management'),
      doc('GridEdge deck.pdf', 'GridEdge'),
      doc('Myton Rail Corridor Study.pdf', 'Myton Development'),
    ],
    'unparented'
  )
  assert.equal(held, 2)
})

test('a record whose name is only filler words can never auto-file', () => {
  // identifiesRecord refuses when the name carries no distinguishing word, so
  // "The Project" cannot collect documents on its filler.
  const rows = [doc('The Project update.docx', 'The Project')]
  assert.deepEqual(filed(rows), [])
})
