/**
 * Filing a Developer Note — the one write path, and the duplicate gate on it.
 *
 * The gate exists because of a measured failure: the GridEdge offer was asked
 * for six times across three days, because the ask reached no destination. The
 * answer to the SEVENTH asking must be "it is already on the list, here it is"
 * — not a seventh row, and not silence.
 *
 * ⚠ Every assertion here is about the gate being RECOVERABLE as well as strict.
 * The bar (0.8) is borrowed from CommitmentsLedger, the one place in this repo
 * where it was measured, because `dev_notes` held 0 rows when this was written
 * and §12 forbids pretending a chosen threshold was measured. A borrowed bar is
 * only safe while a false positive costs a sentence instead of the ask.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { DUPLICATE_BAR, fileDevNote, findSimilarOpenNotes, titleTokens } from './file'
import { jaccard } from '@/lib/utils/similarity'
import type { DevNoteRow } from './queries'
import { DEV_NOTE_KINDS, DEV_NOTE_KIND_LABELS } from '@/lib/utils/dev-notes'
import { moduleTools } from '@/lib/ai/agent-tools-modules'

type Client = Parameters<typeof fileDevNote>[1]

function note(over: Partial<DevNoteRow>): DevNoteRow {
  return {
    id: 'note-' + (over.title ?? 'x'),
    kind: 'feature',
    title: 'untitled',
    body: null,
    page_path: null,
    user_agent: null,
    reporter_id: null,
    reporter_name: 'Richard',
    status: 'open',
    priority: 'normal',
    resolution: null,
    resolved_at: null,
    resolved_by: null,
    created_at: '2026-10-22T00:00:00Z',
    updated_at: null,
    ...over,
  }
}

/**
 * A client that answers the two chains `fileDevNote` uses and records what it
 * was asked. Deliberately NOT a stub that always succeeds: the filters it
 * receives are half of what is under test, so they are captured and asserted.
 */
function fakeClient(existing: DevNoteRow[]) {
  const seen = { statuses: [] as string[][], kinds: [] as string[], inserted: [] as Record<string, unknown>[] }

  const reader = () => {
    const builder: Record<string, unknown> = {}
    builder.in = (_col: string, values: string[]) => {
      seen.statuses.push(values)
      return builder
    }
    builder.eq = (_col: string, value: string) => {
      seen.kinds.push(value)
      return builder
    }
    // `await query` — PostgREST builders are thenable, not promises.
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: existing, error: null }).then(resolve)
    return builder
  }

  const client = {
    from: () => ({
      select: reader,
      insert: (row: Record<string, unknown>) => {
        seen.inserted.push(row)
        return {
          select: () => ({
            single: async () => ({ data: note({ id: 'new-id', ...row } as Partial<DevNoteRow>), error: null }),
          }),
        }
      },
    }),
  } as unknown as Client

  return { client, seen }
}

const ASK = 'Add a bid deadline reminder to the leads page'

test('a matching OPEN note blocks the filing and is handed back', async () => {
  const { client, seen } = fakeClient([note({ id: 'first', title: ASK })])
  const result = await fileDevNote({ kind: 'feature', title: ASK, reporterId: null, reporterName: 'Richard' }, client)

  assert.equal(result.ok, false)
  assert.ok(!result.ok && result.reason === 'duplicate')
  if (!result.ok && result.reason === 'duplicate') {
    assert.deepEqual(result.candidates.map((c) => c.note.id), ['first'])
    assert.ok(result.candidates[0].similarity >= DUPLICATE_BAR)
  }
  // Nothing was written. The ask is not lost — it is the row already there.
  assert.equal(seen.inserted.length, 0)
})

test('⚠ THE MEASURED DUPLICATE PAIR — THE ONE THAT DEFEATED A BAR OF 0.8', async () => {
  /**
   * These two titles are not invented. Asked the identical question in two
   * conversations, the live agent wrote:
   *
   *   "Weekly Slack notification of steel quotes"
   *   "Scheduled weekly steel pipeline digest to Slack"
   *
   * The same ask. They score 0.375, so the borrowed 0.8 bar never fired and a
   * second row was filed — caught by the first live run, not by any unit test,
   * because every fixture until now had built the duplicate by reusing one
   * string (§12: a fixture that builds the field directly cannot catch a
   * producer that never fills it). This is the regression.
   */
  const first = 'Weekly Slack notification of steel quotes'
  const again = 'Scheduled weekly steel pipeline digest to Slack'

  const sim = jaccard(titleTokens(first), titleTokens(again))
  assert.ok(sim >= DUPLICATE_BAR, `the measured duplicate pair scores ${sim} — under the bar of ${DUPLICATE_BAR}`)
  assert.ok(sim < 0.8, 'if this pair ever reaches 0.8 the regression it guards has gone')

  const { client, seen } = fakeClient([note({ id: 'first', title: first })])
  const result = await fileDevNote({ kind: 'feature', title: again, reporterId: null, reporterName: 'R' }, client)
  assert.ok(!result.ok && result.reason === 'duplicate', 'the model re-titling its own ask filed a second row')
  assert.equal(seen.inserted.length, 0)
})

test('every candidate over the bar comes back, not just the best one', async () => {
  const { client } = fakeClient([
    note({ id: 'one', title: 'Weekly Slack notification of steel quotes' }),
    note({ id: 'two', title: 'Scheduled weekly steel digest to Slack' }),
  ])
  const result = await fileDevNote(
    { kind: 'feature', title: 'Post weekly steel quotes to Slack', reporterId: null, reporterName: 'R' },
    client
  )
  assert.ok(!result.ok && result.reason === 'duplicate')
  if (!result.ok && result.reason === 'duplicate') {
    assert.equal(result.candidates.length, 2, 'only the top candidate was handed back')
    // Ranked, so the reader reads the likeliest first.
    assert.ok(result.candidates[0].similarity >= result.candidates[1].similarity)
  }
})

test('the bar separates the measured duplicate from plausible unrelated titles', () => {
  // §12: a threshold is measured against the real corpus. The window this bar
  // sits in is (0.222, 0.375] — asserted here so a later nudge has to confront
  // the measurement rather than just moving the constant.
  const dup = jaccard(
    titleTokens('Weekly Slack notification of steel quotes'),
    titleTokens('Scheduled weekly steel pipeline digest to Slack')
  )
  const unrelated = [
    'Add a bid deadline reminder to the leads page',
    'Dino payment schedule totals are wrong',
    'Export the projects list to Excel',
    'Add a column for square footage on the steel pipeline',
    'Steel quote PDF is missing the salesperson name',
    'Let me assign a task from the meeting page',
  ]
  const worst = Math.max(
    ...unrelated.flatMap((a, i) =>
      unrelated.slice(i + 1).map((b) => jaccard(titleTokens(a), titleTokens(b)))
    ),
    ...unrelated.map((u) =>
      Math.max(
        jaccard(titleTokens(u), titleTokens('Weekly Slack notification of steel quotes')),
        jaccard(titleTokens(u), titleTokens('Scheduled weekly steel pipeline digest to Slack'))
      )
    )
  )
  assert.ok(worst < DUPLICATE_BAR, `an unrelated pair scores ${worst}, at or over the bar ${DUPLICATE_BAR}`)
  assert.ok(DUPLICATE_BAR <= dup, `the bar ${DUPLICATE_BAR} is above the real duplicate at ${dup}`)
})

test('the refusal is RECOVERABLE — allowDuplicate files it anyway', async () => {
  const { client, seen } = fakeClient([note({ id: 'first', title: ASK })])
  const result = await fileDevNote(
    { kind: 'feature', title: ASK, reporterId: null, reporterName: 'Richard', allowDuplicate: true },
    client
  )
  assert.ok(result.ok)
  assert.equal(seen.inserted.length, 1)
  // ⚠ And it does not even ASK: a caller who means it should not pay for a
  // read, and more importantly the gate cannot refuse what it never ran.
  assert.equal(seen.statuses.length, 0)
})

test('an unrelated open note does not block a new ask', async () => {
  const { client, seen } = fakeClient([
    note({ id: 'other', title: 'Dino payment schedule totals are wrong' }),
  ])
  const result = await fileDevNote({ kind: 'feature', title: ASK, reporterId: null, reporterName: 'Richard' }, client)
  assert.ok(result.ok, 'an unrelated open note must not swallow a new ask')
  assert.equal(seen.inserted.length, 1)
})

test('⚠ ONLY OPEN WORK BLOCKS — a done or declined note is a fresh ask', async () => {
  const { client, seen } = fakeClient([])
  await fileDevNote({ kind: 'feature', title: ASK, reporterId: null, reporterName: 'Richard' }, client)
  // The filter is asserted rather than the outcome: a `done` note means the
  // thing was BUILT and a `wont_do` means it was DECLINED, so re-asking about
  // either is legitimate and must not be mistaken for a repeat.
  assert.deepEqual(seen.statuses, [['open', 'in_progress']])
  assert.equal(seen.inserted.length, 1)
})

test('the duplicate check is scoped to the same kind', async () => {
  const { client, seen } = fakeClient([])
  await fileDevNote({ kind: 'bug', title: ASK, reporterId: null, reporterName: 'Richard' }, client)
  assert.deepEqual(seen.kinds, ['bug'])
})

test('an empty or whitespace title is refused by name, not inserted', async () => {
  const { client, seen } = fakeClient([])
  for (const title of ['', '   ', '\n\t']) {
    const result = await fileDevNote({ kind: 'feature', title, reporterId: null, reporterName: 'R' }, client)
    assert.ok(!result.ok && result.reason === 'invalid', `"${title}" was accepted`)
  }
  assert.equal(seen.inserted.length, 0)
})

test('an unknown kind falls back rather than throwing — a tool call must answer', async () => {
  // §12 / agent-tools: a throw inside a tool kills the whole turn, and the
  // model can always send a value the column has never heard of.
  const { client, seen } = fakeClient([])
  const result = await fileDevNote(
    { kind: 'wishlist', title: ASK, reporterId: null, reporterName: 'R' },
    client
  )
  assert.ok(result.ok)
  assert.ok(DEV_NOTE_KINDS.includes(seen.inserted[0].kind as never))
})

test('the stored row is bounded, so a long model answer cannot be the whole note', async () => {
  const { client, seen } = fakeClient([])
  await fileDevNote(
    { kind: 'feature', title: 'T'.repeat(500), body: 'B'.repeat(9000), reporterId: null, reporterName: 'R' },
    client
  )
  const row = seen.inserted[0]
  assert.equal((row.title as string).length, 300)
  assert.equal((row.body as string).length, 8000)
})

test('an absent body is NULL, never an empty string', async () => {
  const { client, seen } = fakeClient([])
  await fileDevNote({ kind: 'feature', title: ASK, body: '   ', reporterId: null, reporterName: 'R' }, client)
  assert.equal(seen.inserted[0].body, null)
})

test('findSimilarOpenNotes ranks most-similar first and drops the unrelated', async () => {
  const { client } = fakeClient([
    note({ id: 'unrelated', title: 'Dino payment schedule is wrong' }),
    note({ id: 'exact', title: ASK }),
    note({ id: 'partial', title: 'Add a reminder to the leads page' }),
  ])
  const ranked = await findSimilarOpenNotes(ASK, client)
  assert.deepEqual(ranked.map((r) => r.note.id), ['exact', 'partial'])
  assert.equal(ranked[0].similarity, 1)
  assert.ok(ranked[1].similarity < 1)
})

// ───────────────────────────────────────────────────────────────────────────────

test('⚠ THE AGENT TOOL\'S KIND LIST IS GENERATED FROM THE REGISTRY', () => {
  // §12: a taxonomy written into a prompt is a second schema and it drifts
  // silently, because a category the model was never told about simply never
  // fires. Adding a kind to DEV_NOTE_KINDS must reach the model with no second
  // edit — which holds only while the description is interpolated.
  const tool = moduleTools.find((t) => t.name === 'file_dev_note')
  assert.ok(tool, 'file_dev_note is not declared')
  const described = (tool.parameters.properties as Record<string, { description: string }>).kind.description

  for (const kind of DEV_NOTE_KINDS) {
    assert.ok(described.includes(kind), `${kind} never reaches the model`)
    assert.ok(described.includes(DEV_NOTE_KIND_LABELS[kind]), `${kind}'s label never reaches the model`)
  }
})

test('the kinds are not spelled out a second time in the tool module', () => {
  /**
   * The companion to the test above: generating the list is only load-bearing
   * while nobody has ALSO written it by hand nearby.
   *
   * ⚠ MATCHED AS A LIST, AND TWO FALSE POSITIVES FORCED THAT — the identical
   * trap `compose-kinds.test.ts` fell into twice, and "require two" did not
   * escape it either, because the two innocent hits are two DIFFERENT kinds:
   *
   *   `kind: str(args.kind) ?? 'feature'` — a documented single DEFAULT for a
   *   missed argument, which is not an enumeration.
   *
   *   `required: ['question']` — a different tool's required PARAMETER, which
   *   happens to be named `question`.
   *
   * Both are honest words in unrelated code (§12: these keys are ordinary
   * words and a word search can never tell a taxonomy from a sentence). What a
   * hand-written enumeration actually looks like is two kinds ADJACENT, joined
   * by a comma or a pipe — an array literal or a union. That is the shape.
   */
  const src = readFileSync('src/lib/ai/agent-tools-modules.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  const kinds = DEV_NOTE_KINDS.join('|')
  const asList = new RegExp(`'(?:${kinds})'\\s*[,|]\\s*'(?:${kinds})'`)
  const hit = asList.exec(src)

  assert.equal(
    hit,
    null,
    `the tool module enumerates dev-note kinds by hand (${hit?.[0]}) instead of reading DEV_NOTE_KINDS`
  )
})
