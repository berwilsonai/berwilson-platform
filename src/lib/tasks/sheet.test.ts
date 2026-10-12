import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLUMNS,
  byUrgency,
  collectInstructions,
  columnLetter,
  readTick,
  wantedTabs,
  type MemberRow,
  type TabRead,
  type TaskRow,
} from './sheet'

/**
 * The read-back rules, pinned.
 *
 * The whole correctness argument for this module is four lines of truth table
 * (see the module docstring): a tick on an open tab means settle it, an untick
 * on the Done tab means reopen it, and the other two arms mean NOTHING because
 * they are the state the last rebuild rendered. Those two no-op arms are what
 * make a late read harmless, and they are the ones a future edit would quietly
 * get wrong — so each is a named test rather than a comment.
 */

const COL_ID = COLUMNS.length - 1

/** A row as it comes back from the API: Done in A, task id in the last column. */
function row(done: unknown, id: string, title = 'A task'): (string | number | boolean | null)[] {
  const cells = Array<string | number | boolean | null>(COLUMNS.length).fill('')
  cells[0] = done as string | number | boolean | null
  cells[1] = title
  cells[COL_ID] = id
  return cells
}

const TASK_A = '11111111-1111-4111-8111-111111111111'
const TASK_B = '22222222-2222-4222-8222-222222222222'

const RICHARD: MemberRow = {
  id: 'm-richard',
  name: 'Richard',
  email: 'moose@berwilson.com',
  auth_user_id: 'auth-richard',
}

function openTab(rows: ReturnType<typeof row>[], member: MemberRow | null = null): TabRead {
  return { title: member?.name ?? 'All open', kind: 'open', member, rows }
}

function doneTab(rows: ReturnType<typeof row>[]): TabRead {
  return { title: 'Done', kind: 'done', member: null, rows }
}

// ---------------------------------------------------------------------------
// readTick
// ---------------------------------------------------------------------------

test('a real checkbox reads as a boolean', () => {
  assert.equal(readTick(true), true)
  assert.equal(readTick(false), false)
})

test('an empty or absent cell is unticked, not ambiguous', () => {
  // A row shorter than the header comes back with trailing cells ABSENT rather
  // than empty, so `undefined` must mean unticked. Reading it as ambiguous
  // would hold back every row anybody had never touched.
  assert.equal(readTick(undefined), false)
  assert.equal(readTick(null), false)
  assert.equal(readTick(''), false)
})

test('a typed x counts, because somebody will type instead of tick', () => {
  for (const v of ['x', 'X', 'yes', 'TRUE', 'done', '✓', '1']) {
    assert.equal(readTick(v), true, `${v} should count as ticked`)
  }
})

test('anything that is neither ticked nor blank REFUSES rather than guessing', () => {
  // §12: ambiguity must mean no match. "maybe" in a Done column is exactly the
  // case where guessing either way is worse than saying so.
  assert.equal(readTick('maybe'), null)
  assert.equal(readTick('?'), null)
  assert.equal(readTick(7), null)
})

// ---------------------------------------------------------------------------
// The four arms of the truth table
// ---------------------------------------------------------------------------

test('ticked on an open tab settles the task done', () => {
  const { instructions } = collectInstructions([openTab([row(true, TASK_A)])])
  assert.equal(instructions.get(TASK_A)?.instruction, 'done')
})

test('UNTICKED on an open tab means nothing — this is the rendered state', () => {
  // ⚠ The arm that makes a late read harmless. A task completed in the platform
  // at 10:05, against a sheet rendered at 10:00, is read at 10:15 as unticked
  // on an open tab. If that meant "reopen", every completion made in the
  // platform would be undone by the next sync.
  const { instructions } = collectInstructions([openTab([row(false, TASK_A)])])
  assert.equal(instructions.size, 0)
})

test('unticked on the Done tab reopens the task', () => {
  const { instructions } = collectInstructions([doneTab([row(false, TASK_A)])])
  assert.equal(instructions.get(TASK_A)?.instruction, 'reopen')
})

test('TICKED on the Done tab means nothing — this is the rendered state', () => {
  const { instructions } = collectInstructions([doneTab([row(true, TASK_A)])])
  assert.equal(instructions.size, 0)
})

// ---------------------------------------------------------------------------
// The same task on two tabs
// ---------------------------------------------------------------------------

test('a tick on either open tab wins over a blank on the other', () => {
  // A task appears on "All open" AND its owner's tab, so two cells speak for
  // it. A tick is an affirmative act and a blank is the absence of one — this
  // must NOT be treated as a conflict, or settling from a person's own tab
  // would never work.
  const both = collectInstructions([
    openTab([row(false, TASK_A)]),
    openTab([row(true, TASK_A)], RICHARD),
  ])
  assert.equal(both.instructions.get(TASK_A)?.instruction, 'done')
  assert.equal(both.heldBack.length, 0)
})

test('a tick on a person tab is attributed to that person', () => {
  // Drives the activity_log actor. A settle credited to "system" when a human
  // did it is the §12 actorAdminClient failure one layer out.
  const { instructions } = collectInstructions([
    openTab([row(false, TASK_A)]),
    openTab([row(true, TASK_A)], RICHARD),
  ])
  assert.equal(instructions.get(TASK_A)?.member?.name, 'Richard')
})

test('a tick on a shared tab alone is attributed to nobody, not to a guess', () => {
  const { instructions } = collectInstructions([openTab([row(true, TASK_A)])])
  assert.equal(instructions.get(TASK_A)?.member, null)
})

test('a genuine contradiction is held back, not resolved', () => {
  // Takes a copied row to produce: ticked on an open tab AND unticked on Done.
  const result = collectInstructions([
    openTab([row(true, TASK_A)]),
    doneTab([row(false, TASK_A)]),
  ])
  assert.equal(result.instructions.has(TASK_A), false)
  assert.equal(result.heldBack.length, 1)
  assert.match(result.heldBack[0], /left alone/)
})

// ---------------------------------------------------------------------------
// Rows that are not ours
// ---------------------------------------------------------------------------

test('a row with no task id never creates anything, and is counted', () => {
  // §11: a record is never created without a human confirm step. A pasted row
  // in a shared sheet is indistinguishable from an intended one, so it is
  // ignored — but counted, because a count that is always zero is the only way
  // to notice people are trying to add tasks here.
  const result = collectInstructions([
    openTab([row(true, ''), row(true, 'not-a-uuid'), row(true, TASK_B)]),
  ])
  assert.equal(result.instructions.size, 1)
  assert.equal(result.instructions.get(TASK_B)?.instruction, 'done')
  assert.equal(result.strayRows, 2)
})

test('an entirely blank row is the bottom of the grid, not a stray', () => {
  const blank = Array<string>(COLUMNS.length).fill('')
  const result = collectInstructions([{ ...openTab([]), rows: [blank] }])
  assert.equal(result.strayRows, 0)
  assert.equal(result.heldBack.length, 0)
})

test('an unreadable Done cell holds back only its own row', () => {
  const result = collectInstructions([
    openTab([row('maybe', TASK_A), row(true, TASK_B)]),
  ])
  assert.equal(result.heldBack.length, 1)
  assert.equal(result.instructions.get(TASK_B)?.instruction, 'done')
  assert.equal(result.instructions.has(TASK_A), false)
})

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function task(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: TASK_A,
    title: 'A task',
    what: null,
    why: null,
    assignee_id: null,
    project_id: null,
    opportunity_id: null,
    objective_id: null,
    investor_id: null,
    lead_id: null,
    commitment_id: null,
    due_date: null,
    status: 'open',
    completed_at: null,
    updated_at: null,
    ...over,
  }
}

test('a person gets a tab once they have work, and the shared tabs bracket them', () => {
  const tabs = wantedTabs([RICHARD], [task({ assignee_id: RICHARD.id })], [], 0)
  assert.deepEqual(tabs.map((t) => t.title), ['All open', 'Richard', 'Done'])
})

test('person tabs come AFTER the shared one, which is what decides attribution', () => {
  // ⚠ collectInstructions prefers a later read that names a member, and the
  // read order follows this order. Reversing these silently moves every settle
  // to "the sheet".
  const tabs = wantedTabs([RICHARD], [task({ assignee_id: RICHARD.id })], [], 0)
  assert.ok(tabs.findIndex((t) => t.title === 'Richard') > tabs.findIndex((t) => t.title === 'All open'))
})

test('a member with no work gets no tab', () => {
  const tabs = wantedTabs([RICHARD], [task()], [], 0)
  assert.equal(tabs.some((t) => t.title === 'Richard'), false)
})

test('an existing person tab is KEPT after their work is gone', () => {
  // A tab that comes and goes is worse than an empty one: the bookmark and the
  // habit both point at it.
  const existing = [{ sheetId: 7, title: 'Richard', rowCount: 100, columnCount: 11 }]
  const tabs = wantedTabs([RICHARD], [task()], existing, 0)
  assert.ok(tabs.some((t) => t.title === 'Richard'))
})

test('the Unassigned tab appears only when something is unowned', () => {
  assert.equal(wantedTabs([], [], [], 0).some((t) => t.title === 'Unassigned'), false)
  assert.ok(wantedTabs([], [], [], 3).some((t) => t.title === 'Unassigned'))
})

test('the Unassigned tab, once created, survives reaching zero', () => {
  const existing = [{ sheetId: 9, title: 'Unassigned', rowCount: 100, columnCount: 11 }]
  assert.ok(wantedTabs([], [], existing, 0).some((t) => t.title === 'Unassigned'))
})

// ---------------------------------------------------------------------------
// Ordering and ranges
// ---------------------------------------------------------------------------

test('soonest deadline first, undated last', () => {
  const sorted = [
    task({ id: TASK_A, due_date: null, title: 'undated' }),
    task({ id: TASK_B, due_date: '2026-10-17', title: 'soon' }),
  ].sort(byUrgency)
  assert.equal(sorted[0].title, 'soon')
  // Undated sorts LAST and is still written: nothing here is capped, which is
  // the only reason this ordering is safe (§12, 09-29/10-09).
  assert.equal(sorted[1].title, 'undated')
})

test('column letters are right at and past the Z boundary', () => {
  assert.equal(columnLetter(0), 'A')
  assert.equal(columnLetter(10), 'K') // the task id column today
  assert.equal(columnLetter(25), 'Z')
  assert.equal(columnLetter(26), 'AA')
})

// ---------------------------------------------------------------------------
// Stray rows
// ---------------------------------------------------------------------------

test('a blank grid row carrying only its checkbox is not a paste', () => {
  // What Sheets actually returns below the data: the checkbox validation covers
  // the column, so every empty row holds a real `false`. String(false) is
  // "false", which is why this read as a paste on all 41 runs after the sheet
  // was created — 1000 of them, every time.
  const result = collectInstructions([
    { title: 'All open', kind: 'open', member: null, rows: [[false], [false], [false]] },
  ])
  assert.equal(result.strayRows, 0)
  assert.equal(result.instructions.size, 0)
})

test('a real paste is still counted', () => {
  const result = collectInstructions([
    { title: 'All open', kind: 'open', member: null, rows: [[false, 'call the bank back']] },
  ])
  assert.equal(result.strayRows, 1)
})

test('a ticked row with no task id is a paste, not an instruction', () => {
  const result = collectInstructions([
    { title: 'All open', kind: 'open', member: null, rows: [[true, 'my own note']] },
  ])
  assert.equal(result.strayRows, 1)
  assert.equal(result.instructions.size, 0)
})
