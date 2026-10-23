import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePartyLookup, type PartyLite } from './fold'

function party(over: Partial<PartyLite> = {}): PartyLite {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    full_name: 'Jane Counterparty',
    email: 'jane@counterparty.com',
    is_organization: false,
    status: 'active',
    ...over,
  }
}

test('nothing on file is the only outcome that may create a contact', () => {
  assert.deepEqual(decidePartyLookup([], 'jane@counterparty.com', 'address'), { kind: 'none' })
})

test('one live person is a match', () => {
  const row = party()
  const got = decidePartyLookup([row], 'jane@counterparty.com', 'address')
  assert.equal(got.kind, 'match')
  assert.equal(got.kind === 'match' && got.party.id, row.id)
})

/**
 * The self-amplifying case. Two rows already share the address, so the old
 * code called it "a data problem, not a match", returned no match, and the
 * caller created a THIRD — which is still two-or-more next time.
 */
test('two contacts sharing an address is refused, never a licence to add a third', () => {
  const got = decidePartyLookup([party(), party({ id: '22222222-2222-2222-2222-222222222222' })], 'jane@counterparty.com', 'address')
  assert.equal(got.kind, 'refused')
  assert.match(got.kind === 'refused' ? got.reason : '', /2 contacts share jane@counterparty\.com/)
})

/**
 * The Dino case, measured 2026-10-22. `dinoservicepros@gmail.com` is a role
 * mailbox for our own operating company; the 10-21 merge flagged it as an
 * organization, and the next pass declined it for being one and created a
 * person row beside it on the same address.
 */
test('an organization row holds the address, so no person is created against it', () => {
  const got = decidePartyLookup(
    [party({ full_name: 'Dino Plumbing HVAC & Electrical', email: 'dinoservicepros@gmail.com', is_organization: true })],
    'dinoservicepros@gmail.com',
    'address'
  )
  assert.equal(got.kind, 'refused')
})

/**
 * §12: an automatic pass and its undo are a LOOP unless the undo leaves a mark
 * the pass respects. The archived row IS that mark.
 */
test('a contact a human archived is neither matched nor re-created', () => {
  const got = decidePartyLookup([party({ status: 'archived' })], 'jane@counterparty.com', 'address')
  assert.equal(got.kind, 'refused')
  assert.match(got.kind === 'refused' ? got.reason : '', /archived by hand/)
})

/**
 * The regression that matters, stated as one assertion over all three
 * refusals: the bug was that every one of these returned the same thing as an
 * empty table, and only an empty table may create.
 */
test('no refusal is ever indistinguishable from nothing on file', () => {
  const refusals: PartyLite[][] = [
    [party(), party({ id: '33333333-3333-3333-3333-333333333333' })],
    [party({ is_organization: true })],
    [party({ status: 'archived' })],
  ]
  for (const rows of refusals) {
    assert.notEqual(
      decidePartyLookup(rows, 'jane@counterparty.com', 'address').kind,
      'none',
      'a refusal that reads as "none" creates the duplicate that guarantees the next refusal'
    )
  }
})

test('a name lookup reports the name it refused on, not an address', () => {
  const got = decidePartyLookup([party(), party({ id: '44444444-4444-4444-4444-444444444444' })], 'Trent Staggs', 'name')
  assert.equal(got.kind, 'refused')
  assert.match(got.kind === 'refused' ? got.reason : '', /2 contacts named Trent Staggs/)
})
