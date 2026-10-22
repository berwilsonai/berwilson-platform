/**
 * Reading an intake extraction's follow-ups, for the Decide queue's
 * "Task on ⟨deal⟩" button.
 *
 * ⚠ ONLY `readExtractionTasks` IS EXERCISED HERE, ON PURPOSE.
 * `resolveSessionTaskTarget` reaches the portfolio matchers through
 * `resolveMeetingTarget`, which holds a service-role client — and §12 records
 * five load-time failures a test importing src/lib hits that neither `tsc` nor
 * the build can see. The two resolvers it delegates to have their own tests
 * (merge-target.test.ts) and that is deliberately not re-proved here: a third
 * bar invented for this path is the thing task-target.ts exists to avoid.
 *
 * What IS worth nailing down is the reader, because it serves TWO extraction
 * shapes — `EmailIntakeTask` and `MeetingIntakeTask` — and the way that goes
 * wrong is a second reader written for the second shape (§12).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readExtractionTasks } from './task-target'

test('reads an email extraction’s tasks', () => {
  const tasks = readExtractionTasks({
    tasks: [
      { title: 'Send the signed PSA', what: 'countersigned copy', why: null, how: null, assignee: 'Richard White', due_date: '2026-11-01' },
    ],
  })
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].title, 'Send the signed PSA')
  assert.equal(tasks[0].assignee, 'Richard White')
  assert.equal(tasks[0].due_date, '2026-11-01')
})

test('⚠ reads a MEETING extraction with the same function', () => {
  // A MeetingIntakeTask is a TaskAction minus `include` plus `record_hint`.
  // The extra key is ignored rather than requiring its own reader — and the
  // model's `record_hint` is deliberately NOT read as a target: it names a
  // topic, and only a human's title may file (§12).
  const tasks = readExtractionTasks({
    tasks: [
      { title: 'Price the Case Garage', what: null, why: null, how: null, assignee: null, due_date: null, record_hint: 'Riverdale Site' },
    ],
  })
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].title, 'Price the Case Garage')
  assert.ok(!('record_hint' in tasks[0]))
})

test('⚠ every task is INCLUDED by default', () => {
  // These extractions carry no per-task tick — that lives on the review form's
  // own draft. `createTasksForRecord` filters on `include`, so a default of
  // false would make the button report success and write nothing.
  const tasks = readExtractionTasks({ tasks: [{ title: 'Call the county' }] })
  assert.equal(tasks[0].include, true)
})

test('an untitled task is dropped, not written blank', () => {
  const tasks = readExtractionTasks({
    tasks: [{ title: '   ' }, { title: '' }, { title: 'Real one' }],
  })
  assert.deepEqual(tasks.map((t) => t.title), ['Real one'])
})

test('empty strings become null rather than landing as empty columns', () => {
  const tasks = readExtractionTasks({ tasks: [{ title: 'T', what: '', assignee: '  ', due_date: '' }] })
  assert.equal(tasks[0].what, null)
  assert.equal(tasks[0].assignee, null)
  assert.equal(tasks[0].due_date, null)
})

test('⚠ a malformed extraction returns nothing rather than throwing', () => {
  // `extraction_result` is jsonb and predates several shape changes, so an
  // element can be null or a scalar. Reading a field off one of those THREW
  // and 500'd the merge button on a human's click — the same bug this guards
  // against, one module over (see merge-target.ts).
  assert.deepEqual(readExtractionTasks(null), [])
  assert.deepEqual(readExtractionTasks({}), [])
  assert.deepEqual(readExtractionTasks({ tasks: null }), [])
  assert.deepEqual(readExtractionTasks({ tasks: 'none' }), [])
  assert.deepEqual(readExtractionTasks({ tasks: [null, 7, 'x'] }), [])
  assert.equal(readExtractionTasks({ tasks: [null, { title: 'Survives' }] }).length, 1)
})

test('a title is trimmed, so it never lands with the model’s whitespace', () => {
  assert.equal(readExtractionTasks({ tasks: [{ title: '  Order steel  ' }] })[0].title, 'Order steel')
})
