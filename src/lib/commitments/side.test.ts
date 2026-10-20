import test from 'node:test'
import assert from 'node:assert/strict'
import { correctSides } from './side'
import type { PepperMember } from '@/lib/pepper/attribution'

/**
 * The real roster, with the spellings the live ledger actually holds.
 * `tokens` is what `loadPepperMembers` builds from team_members + parties.
 */
const MEMBERS: PepperMember[] = [
  {
    id: 'richard',
    name: 'Richard',
    email: 'moose@berwilson.com',
    firstName: 'Richard',
    mailbox: 'moose@berwilson.com',
    isAssistantSeat: false,
    tokens: new Set(['richard', 'white', 'moose']),
    addresses: new Set(['moose@berwilson.com']),
  },
  {
    id: 'eric',
    name: 'Eric',
    email: 'tuaone@berwilson.com',
    firstName: 'Eric',
    mailbox: 'tuaone@berwilson.com',
    isAssistantSeat: false,
    tokens: new Set(['eric', 'ericson', 'tuaone']),
    addresses: new Set(['tuaone@berwilson.com']),
  },
]

const row = (side: 'us' | 'them', owner_name: string | null) => ({ side, owner_name })

test("an obligation filed as theirs but owned by one of ours becomes ours", () => {
  const { rows, corrections } = correctSides(
    [row('them', "Ericson Tua'one")],
    MEMBERS
  )
  assert.equal(rows[0].side, 'us')
  assert.equal(corrections.length, 1)
  assert.equal(corrections[0].memberId, 'eric')
})

/**
 * The four spellings of Eric's surname in the live ledger. `normalizeName`
 * deletes the apostrophe rather than splitting on it, so all of these have to
 * land on the same person — that is the whole reason this reuses
 * `resolveOwnerName` instead of a fresh name test.
 */
for (const spelling of ["Ericson Tua'one", 'Ericson Tua’one', 'Eric Tuaone', 'Ericson', 'Eric']) {
  test(`"${spelling}" resolves to Eric and flips the side`, () => {
    const { rows } = correctSides([row('them', spelling)], MEMBERS)
    assert.equal(rows[0].side, 'us')
  })
}

test('a genuine counterparty is left alone', () => {
  const { rows, corrections } = correctSides(
    [row('them', 'Bahadir Yetki'), row('them', 'Jonathan Houk')],
    MEMBERS
  )
  assert.deepEqual(rows.map((r) => r.side), ['them', 'them'])
  assert.equal(corrections.length, 0)
})

test('a row with no named owner is left alone', () => {
  const { rows } = correctSides([row('them', null), row('them', '  ')], MEMBERS)
  assert.deepEqual(rows.map((r) => r.side), ['them', 'them'])
})

/**
 * ⚠ ONE DIRECTION ONLY. The extractor errs toward `them` on purpose, so
 * reversing a deliberate `us` on a counterparty name would undo that choice
 * with a weaker signal than the one that made it.
 */
test('an obligation already ours is never pushed to the counterparty', () => {
  const { rows, corrections } = correctSides([row('us', 'Bahadir Yetki')], MEMBERS)
  assert.equal(rows[0].side, 'us')
  assert.equal(corrections.length, 0)
})

test('a name naming both executives resolves nobody and does not move', () => {
  const { rows } = correctSides([row('them', 'Richard and Eric')], MEMBERS)
  assert.equal(rows[0].side, 'them')
})

/** The company is not a person — `wilson` belongs to no member's token set. */
test('the company name does not resolve a member', () => {
  const { rows } = correctSides([row('them', 'Ber Wilson')], MEMBERS)
  assert.equal(rows[0].side, 'them')
})

test('corrections carry the index of the row that moved', () => {
  const { corrections } = correctSides(
    [row('them', 'Jonathan Houk'), row('them', 'Richard White'), row('us', null)],
    MEMBERS
  )
  assert.equal(corrections.length, 1)
  assert.equal(corrections[0].index, 1)
  assert.equal(corrections[0].ownerName, 'Richard White')
})
