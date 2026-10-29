/**
 * Which write each /decide row performs.
 *
 * ⚠ THE BUG THESE EXIST FOR: the routing was an `if/else if` chain inside the
 * client component, reading `item.kind === 'document' || item.kind === 'misfiled'`,
 * with a trailing `else` that PATCHed `/api/review/<id>`. `unparented` — a
 * third document-shaped kind added later — fell straight through it. Measured
 * 2026-10-28: **120 live rows** in the "No deal yet" class whose Accept button
 * answered `404 Review item not found`. Typecheck, build and 802 tests were all
 * green, because every arm of that chain takes a string.
 *
 * So the point of this file is not the individual assertions — it is the LAST
 * one, which walks every kind and asserts the request lands at a URL that kind
 * actually lives at. A kind added tomorrow fails it rather than quietly
 * acquiring the review route.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planAccept, type AcceptSubject } from './accept-request'
import type { DecideKind, AcceptAction } from './types'

const STEELTON = { kind: 'project' as const, id: 'p-1' }

function row(kind: DecideKind, extra: Partial<AcceptSubject> = {}): AcceptSubject {
  return { id: `${kind}-id`, kind, ...extra }
}

test('an unparented document files through the DOCUMENTS route, not the review route', () => {
  // The regression itself, named.
  const plan = planAccept(row('unparented', { fileTarget: STEELTON }), 'file')
  assert.equal(plan.kind, 'request')
  assert.equal(plan.kind === 'request' && plan.url, '/api/documents/unparented-id/refile')
})

test('setting an unparented file aside excludes it, and does not reject a review item', () => {
  const plan = planAccept(row('unparented', { note: 'not a document' }), 'setaside')
  assert.equal(plan.kind === 'request' && plan.url, '/api/documents/unparented-id/refile')
  assert.deepEqual(plan.kind === 'request' && plan.body, {
    exclude: true,
    reason: 'not a document',
    source: 'documents',
  })
})

test('a chosen record beats the row’s own proposed target', () => {
  const plan = planAccept(
    row('misfiled', { fileTarget: { kind: 'project', id: 'wrong' }, fileSource: 'opportunity_documents' }),
    'file',
    { kind: 'opportunity', id: 'o-9' }
  )
  assert.deepEqual(plan.kind === 'request' && plan.body, {
    target: { kind: 'opportunity', id: 'o-9' },
    source: 'opportunity_documents',
  })
})

test('an opportunity document names its own table, never the default', () => {
  const plan = planAccept(
    row('document', { fileTarget: STEELTON, fileSource: 'opportunity_documents' }),
    'file'
  )
  assert.equal(
    plan.kind === 'request' && (plan.body as { source: string }).source,
    'opportunity_documents'
  )
})

test('filing with no destination at all REFUSES rather than posting a half request', () => {
  const plan = planAccept(row('document'), 'file')
  assert.equal(plan.kind, 'refused')
})

test('a picked record rides on merge and on task alike', () => {
  assert.deepEqual(planAccept(row('intake'), 'merge', STEELTON), {
    kind: 'request',
    method: 'POST',
    url: '/api/email-ingestion/merge',
    body: { session_id: 'intake-id', target: { kind: 'project', id: 'p-1' } },
  })
  assert.deepEqual(planAccept(row('intake'), 'task', STEELTON), {
    kind: 'request',
    method: 'POST',
    url: '/api/email-ingestion/tasks',
    body: { session_id: 'intake-id', target: { kind: 'project', id: 'p-1' } },
  })
})

test('no pick means no target key — an absent field, never an explicit null', () => {
  // §12: a field the caller never mentioned must be OMITTED. A null `target`
  // would fail the route's validation instead of taking its resolver path.
  assert.deepEqual(planAccept(row('intake'), 'merge').kind === 'request' && (planAccept(row('intake'), 'merge') as { body: unknown }).body, {
    session_id: 'intake-id',
  })
})

test('creating a record reads the review form’s own draft first', () => {
  assert.deepEqual(planAccept(row('intake'), 'project'), {
    kind: 'draft-then-confirm',
    draftUrl: '/api/email-ingestion/sessions/intake-id',
    confirmUrl: '/api/email-ingestion/confirm',
  })
})

test('a flagged item approves, and a field question confirms', () => {
  assert.deepEqual(planAccept(row('review'), 'approve'), {
    kind: 'request',
    method: 'PATCH',
    url: '/api/review/review-id',
    body: { resolution: 'approved' },
  })
  assert.deepEqual(planAccept(row('proposal'), 'confirmfield'), {
    kind: 'request',
    method: 'PATCH',
    url: '/api/provenance/proposals/proposal-id',
    body: { verdict: 'accept' },
  })
})

/**
 * ⚠ THE ONE THAT WOULD HAVE CAUGHT IT.
 *
 * Every kind, against the routes its rows are allowed to reach. A kind that
 * reaches a route belonging to a different table is the whole bug class, so it
 * is asserted directly rather than inferred from the arms above — §12: assert
 * that every member agrees across every switch, rather than fixing them one
 * failure at a time.
 */
const ALL_KINDS: DecideKind[] = [
  'intake',
  'review',
  'document',
  'unparented',
  'misfiled',
  'proposal',
]
const ALL_ACTIONS: AcceptAction[] = [
  'project',
  'opportunity',
  'merge',
  'task',
  'approve',
  'file',
  'setaside',
  'confirmfield',
]
/** Which URL prefixes each kind's rows legitimately live at. */
const ALLOWED: Record<DecideKind, string[]> = {
  intake: ['/api/email-ingestion/'],
  review: ['/api/review/'],
  document: ['/api/documents/'],
  unparented: ['/api/documents/'],
  misfiled: ['/api/documents/'],
  proposal: ['/api/provenance/'],
}

test('no kind can ever be sent to another kind’s route', () => {
  for (const kind of ALL_KINDS) {
    for (const action of ALL_ACTIONS) {
      // Every destination a row could carry, so "file" is reachable for the
      // document kinds and the refusal below means the KIND refused, not the
      // missing target.
      const plan = planAccept(row(kind, { fileTarget: STEELTON }), action, STEELTON)
      if (plan.kind === 'refused') continue
      const urls =
        plan.kind === 'request' ? [plan.url] : [plan.draftUrl, plan.confirmUrl]
      for (const url of urls) {
        assert.ok(
          ALLOWED[kind].some((prefix) => url.startsWith(prefix)),
          `${kind} + ${action} reaches ${url}, which belongs to another table`
        )
      }
    }
  }
})

test('every kind can do at least one thing, or it is a row with a dead button', () => {
  for (const kind of ALL_KINDS) {
    const usable = ALL_ACTIONS.filter(
      (a) => planAccept(row(kind, { fileTarget: STEELTON }), a).kind !== 'refused'
    )
    assert.ok(usable.length > 0, `${kind} can be accepted in no way at all`)
  }
})

test('an unknown kind refuses and names itself, rather than guessing a route', () => {
  const plan = planAccept(
    { id: 'x', kind: 'something-new' as DecideKind },
    'approve'
  )
  assert.equal(plan.kind, 'refused')
  assert.match(plan.kind === 'refused' ? plan.reason : '', /something-new/)
})
