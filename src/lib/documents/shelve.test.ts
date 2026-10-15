import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shelveByFolder, NO_FOLDER, UNSORTED } from './shelve'

const doc = (drive_folder_path: string | null) => ({ drive_folder_path })

test('groups on the whole path, not the first segment', () => {
  const groups = shelveByFolder([
    doc('Diligence/Rail & Transportation'),
    doc('Diligence/Environmental'),
    doc('Diligence/Rail & Transportation'),
  ])
  // Two shelves, not one "Diligence" of three.
  assert.deepEqual(
    groups.map((g) => [g.label, g.docs.length]),
    [
      ['Diligence/Environmental', 1],
      ['Diligence/Rail & Transportation', 2],
    ]
  )
})

test('_Unsorted comes first and the unfiled come last', () => {
  const groups = shelveByFolder([
    doc('Land & Title'),
    doc(null),
    doc(UNSORTED),
    doc('Contracts & Legal'),
  ])
  assert.deepEqual(groups.map((g) => g.label), [
    UNSORTED,
    'Contracts & Legal',
    'Land & Title',
    NO_FOLDER,
  ])
})

test('a blank or whitespace path is unfiled, never its own empty shelf', () => {
  // The real failure this guards: `''` and `'   '` are both "no folder", and
  // treating them as labels produced a nameless group that read as a broken
  // render.
  const groups = shelveByFolder([doc(''), doc('   '), doc(null)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, NO_FOLDER)
  assert.equal(groups[0].docs.length, 3)
})

test('every document lands in exactly one shelf', () => {
  const docs = [
    doc('A'), doc('B'), doc(null), doc(UNSORTED), doc('A'), doc('  B  '),
  ]
  const groups = shelveByFolder(docs)
  assert.equal(groups.reduce((n, g) => n + g.docs.length, 0), docs.length)
  // '  B  ' trims onto 'B' rather than opening a second shelf.
  assert.equal(groups.find((g) => g.label === 'B')?.docs.length, 2)
})

test('ordering is stable under reordered input', () => {
  const a = shelveByFolder([doc('Z'), doc('A'), doc(null)]).map((g) => g.label)
  const b = shelveByFolder([doc(null), doc('A'), doc('Z')]).map((g) => g.label)
  assert.deepEqual(a, b)
})
