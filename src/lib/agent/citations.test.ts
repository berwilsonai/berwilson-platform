import { test } from 'node:test'
import assert from 'node:assert/strict'

import { citationFor, citationsFor } from './citations'

const P = '11111111-1111-1111-1111-111111111111'
const O = '22222222-2222-2222-2222-222222222222'

test('a project id becomes a link to that project', () => {
  const c = citationFor('query_project_data', { project_id: P })
  assert.equal(c.href, `/projects/${P}`)
  assert.equal(c.tool, 'query project data')
})

test('the KIND decides the route, never the shape of the id', () => {
  // §12: a new record type is a destination for the human, and carrying the
  // kind the match came from is what stopped an opportunity's uuid being sent
  // to the projects branch. The two ids are indistinguishable.
  assert.equal(citationFor('t', { record_kind: 'opportunity', record_id: O }).href, `/opportunities/${O}`)
  assert.equal(citationFor('t', { record_kind: 'project', record_id: O }).href, `/projects/${O}`)
  // An unknown kind links nowhere rather than guessing.
  assert.equal(citationFor('t', { record_kind: 'lead', record_id: O }).href, null)
})

test('a non-uuid id never becomes a link', () => {
  // The args came from a model. A hallucinated id must not produce a route.
  for (const bad of ['steelton', '../../etc', '1', '', 'null', 'undefined']) {
    assert.equal(citationFor('t', { project_id: bad }).href, null, bad)
  }
})

test('the search term is shown, and a uuid is not mistaken for one', () => {
  assert.equal(citationFor('search_documents', { query: 'PCA capacity' }).term, 'PCA capacity')
  // A uuid in a term field is the id again — printing it at a reader is noise.
  assert.equal(citationFor('t', { name: P }).term, null)
})

test('a long term is truncated rather than breaking the row', () => {
  const c = citationFor('t', { query: 'x'.repeat(200) })
  assert.ok(c.term!.length <= 48, `${c.term!.length}`)
  assert.ok(c.term!.endsWith('…'))
})

test('a tool call with nothing routable still names what was consulted', () => {
  const c = citationFor('list_projects', { limit: 20 })
  assert.equal(c.href, null)
  assert.equal(c.term, null)
  assert.equal(c.tool, 'list projects')
})

test('identical citations are shown once', () => {
  // A turn may run twelve tool rounds and routinely calls the same tool
  // repeatedly; two identical chips are a worse citation than one.
  const cites = citationsFor([
    { name: 'query_project_data', args: { project_id: P } },
    { name: 'query_project_data', args: { project_id: P } },
    { name: 'query_project_data', args: { project_id: O } },
  ])
  assert.equal(cites.length, 2)
})

test('no tool calls means no citation block', () => {
  assert.deepEqual(citationsFor(undefined), [])
  assert.deepEqual(citationsFor([]), [])
  // A malformed stored message must not throw mid-render.
  assert.equal(citationsFor([{ name: 'x' } as never]).length, 1)
})

test('every href is an internal path', () => {
  const cites = citationsFor([
    { name: 'a', args: { project_id: P } },
    { name: 'b', args: { opportunity_id: O } },
    { name: 'c', args: { investor_id: P } },
    { name: 'd', args: { party_id: O } },
  ])
  assert.equal(cites.length, 4)
  for (const c of cites) {
    assert.ok(c.href?.startsWith('/') && !c.href.startsWith('//'), c.href ?? 'null')
  }
})
