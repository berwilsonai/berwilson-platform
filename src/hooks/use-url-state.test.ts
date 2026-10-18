import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * `useUrlState` cannot be called outside a Next request (the navigation hooks
 * throw "invariant expected app router to be mounted"), so this asserts the
 * three properties that are decisions rather than mechanics — each of which
 * reverses a specific bug — by reading the source.
 *
 * A render-level check would need the whole app-router context; what matters
 * here is that nobody quietly changes `replace` to `push`, serialises the
 * default into the URL, or drops the validation.
 */
const src = readFileSync('src/hooks/use-url-state.ts', 'utf8')

test('it replaces rather than pushes', () => {
  // Changing a filter is not navigation. With `push`, Back walks the reader
  // through every dropdown they touched instead of returning them to the page
  // they came from.
  assert.ok(src.includes('router.replace('), 'expected router.replace')
  assert.ok(!src.includes('router.push('), 'a filter change must not be a history entry')
})

test('the default value is deleted from the URL, never written to it', () => {
  // A bare URL must mean the default view — the whole reason the localStorage
  // replay was removed from the projects filters, where a bare /projects
  // rendered differently for each executive.
  assert.ok(/next === fallback\) p\.delete\(key\)/.test(src.replace(/\s+/g, ' ')),
    'the fallback must be removed from the query string, not serialised')
})

test('the incoming value is validated against the allowed set', () => {
  // A query string is user input and reaches a database filter. §12: a value
  // outside an enum fails the WHOLE query with 22P02 and a null row set.
  assert.ok(src.includes('allow'), 'expected an allow-list parameter')
  assert.ok(/includes\(raw\)/.test(src), 'expected the raw value to be checked against it')
})

test('scroll is suppressed, so changing a filter does not jump the page', () => {
  assert.ok(src.includes('scroll: false'))
})

test('the task board passes its status filter an allow-list', () => {
  // The one filter with a closed vocabulary — and the one that reaches
  // `.eq('status', …)`. The array is the source of both the type and the guard.
  const board = readFileSync('src/components/tasks/TeamTaskBoard.tsx', 'utf8')
  assert.ok(board.includes("const STATUS_FILTERS = ['open', 'done'] as const"))
  assert.ok(board.includes("useUrlState<StatusFilter>('status', 'open', STATUS_FILTERS)"))
  assert.ok(board.includes('type StatusFilter = (typeof STATUS_FILTERS)[number]'),
    'the type must derive from the array, or the guard and the type can disagree')
})

test('no task-board filter is left in component state', () => {
  const board = readFileSync('src/components/tasks/TeamTaskBoard.tsx', 'utf8')
  for (const name of ['status', 'assigneeFilter', 'projectFilter', 'opportunityFilter', 'investorFilter', 'objectiveFilter']) {
    const useState = new RegExp(`\\[${name}, set\\w+\\] = useState`)
    assert.ok(!useState.test(board), `${name} is back in useState — it is not a view`)
  }
})
