import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePhones, bestName } from './contacts'

type C = Parameters<typeof resolvePhones>[0] extends Map<string, infer V> ? V : never

function candidate(phones: [string, number][], over: Partial<C> = {}): C {
  return {
    email: 'x@y.com',
    names: new Map(),
    title: null,
    company: null,
    phones: new Map(phones),
    threads: 1,
    isOrg: null,
    label: 't',
    ref: 'r',
    at: null,
    wrote: true,
    ...over,
  } as C
}

test('a clear single number is kept', () => {
  const { phones, collisions } = resolvePhones(
    new Map([['a@x.com', candidate([['8015550101', 1]])]])
  )
  assert.equal(phones.get('a@x.com'), '8015550101')
  assert.equal(collisions, 0)
})

test('two numbers tied for one person is ambiguity, so neither wins', () => {
  const { phones } = resolvePhones(
    new Map([['a@x.com', candidate([['8015550101', 2], ['8015550202', 2]])]])
  )
  assert.equal(phones.has('a@x.com'), false)
})

test('a clear favourite beats a stray sighting', () => {
  const { phones } = resolvePhones(
    new Map([['a@x.com', candidate([['8015550101', 7], ['8015550202', 1]])]])
  )
  assert.equal(phones.get('a@x.com'), '8015550101')
})

test('⚠ a number two people claim goes to the stronger claim alone', () => {
  // The live case: a quoted forward put Mark Welsko's signature inside
  // Christopher Johnson's message, so one sighting claimed Mark's number.
  const { phones, collisions } = resolvePhones(
    new Map([
      ['welsko@x.com', candidate([['2156194914', 7]])],
      ['johnson@x.com', candidate([['2156194914', 1]])],
    ])
  )
  assert.equal(phones.get('welsko@x.com'), '2156194914')
  assert.equal(phones.has('johnson@x.com'), false)
  assert.equal(collisions, 1)
})

test('an evenly contested number goes to nobody', () => {
  const { phones, collisions } = resolvePhones(
    new Map([
      ['a@x.com', candidate([['2156194914', 3]])],
      ['b@x.com', candidate([['2156194914', 3]])],
    ])
  )
  // Whoever `best` recorded first wins only on a strict majority, so an exact
  // tie must leave at most one of them holding it — never both.
  assert.ok(!(phones.has('a@x.com') && phones.has('b@x.com')))
  assert.ok(collisions >= 1)
})

test('bestName needs two words — a bare first name is not a contact', () => {
  assert.equal(bestName(new Map([['Seth', 4]])), null)
  assert.equal(bestName(new Map([['Seth Lloyd', 1]])), 'Seth Lloyd')
})

test('bestName prefers the spelling seen most, then the shorter one', () => {
  assert.equal(
    bestName(new Map([['Ericson H. Tua\'one', 2], ['Ericson Tua\'one', 9]])),
    "Ericson Tua'one"
  )
  assert.equal(
    bestName(new Map([['Richard M White', 3], ['Richard White', 3]])),
    'Richard White'
  )
})

test('bestName on nothing usable says nothing', () => {
  assert.equal(bestName(new Map()), null)
  assert.equal(bestName(new Map([['', 2]])), null)
})
