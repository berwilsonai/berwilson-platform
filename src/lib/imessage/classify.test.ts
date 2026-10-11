import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyChat, nameTokens, normalizePhone, termRegex } from './classify'

/**
 * The two bugs that made the first survey select 94.4% of a personal message
 * history are asserted here by name. Both were §12 lessons already written
 * down, which is exactly why they are tests now and not comments.
 */

const EMPTY = {
  partyPhones: new Set<string>(),
  recordTokens: new Map<string, string>(),
  singleTokenRecords: new Set<string>(),
  excludedHandles: new Set<string>(),
}

function chat(messages: string[], over: Partial<Parameters<typeof classifyChat>[0]> = {}) {
  return classifyChat({
    handles: ['+18015550100'],
    messages,
    sentByMe: Math.max(1, Math.floor(messages.length / 2)),
    ...EMPTY,
    ...over,
  })
}

test('⚠ "nda" must NOT match "Monday" — the substring bug', () => {
  // `includes('nda')` put a deal term on nearly every conversation in the
  // corpus, because Monday/Sunday/agenda all contain it.
  assert.equal(termRegex('nda').test('see you monday'), false)
  assert.equal(termRegex('nda').test('sign the NDA first'), true)
  assert.equal(termRegex('bid').test('forbidden'), false)
  assert.equal(termRegex('plat').test('paper plates'), false)
  assert.equal(termRegex('plat').test('the plat was recorded'), true)
})

test('a personal thread with no business signal is not business', () => {
  const v = chat(['running late', 'no worries', 'see you at the pub', 'bring the kit'])
  assert.equal(v.business, false)
  assert.equal(v.reason, 'no business signal')
})

test('⚠ one name token is NOT a match — the Case Garage bug', () => {
  // "Case Garage" tokenizes to case/garage; a rugby group chat saying "put it
  // in the garage" claimed the record. Two tokens must co-occur unless the
  // caller has certified the lone token as rare.
  const recordTokens = new Map([
    ['case', 'Case Garage'],
    ['garage', 'Case Garage'],
  ])
  const one = chat(['put it in the garage'], { recordTokens })
  assert.deepEqual(one.signals.namedRecords, [], 'a single token must not name the record')
  assert.equal(one.business, false)

  const both = chat(['the Case Garage slab is poured'], { recordTokens })
  assert.deepEqual(both.signals.namedRecords, ['Case Garage'])
})

test('a lone token names a record only when the caller says it is rare enough', () => {
  const recordTokens = new Map([['steelton', 'Steelton — Cleveland-Cliffs (PA)']])
  const without = chat(['heading to steelton tomorrow'], { recordTokens })
  assert.deepEqual(without.signals.namedRecords, [])

  const with_ = chat(['heading to steelton tomorrow'], {
    recordTokens,
    singleTokenRecords: new Set(['Steelton — Cleveland-Cliffs (PA)']),
  })
  assert.deepEqual(with_.signals.namedRecords, ['Steelton — Cleveland-Cliffs (PA)'])
  assert.equal(with_.business, true)
})

test("a known party's own number clears the bar by itself", () => {
  // The directory entry is a human filing decision — the strongest evidence
  // available, and the same reasoning that governs learned identifiers.
  const v = chat(['ok', 'thanks'], {
    handles: ['+18015550100'],
    partyPhones: new Set(['8015550100']),
  })
  assert.equal(v.signals.knownParty, true)
  assert.equal(v.business, true)
})

test('marketing written in deal vocabulary is still excluded', () => {
  // Verbatim shape from this corpus: insurance spam scores on terms alone.
  const v = classifyChat({
    handles: ['55512'],
    messages: ['Self Employed or Business Owner? You may qualify for new coverage. Invoice financing and bonding available.'],
    sentByMe: 0,
    ...EMPTY,
  })
  assert.equal(v.business, false)
  assert.match(v.reason, /short-code/)
})

test('a broadcast never replied to is excluded', () => {
  const v = classifyChat({
    handles: ['+18885551234'],
    messages: ['your bid is due', 'reminder: bid due', 'final notice on the bid'],
    sentByMe: 0,
    ...EMPTY,
  })
  assert.equal(v.business, false)
  assert.match(v.reason, /broadcast/)
})

test('⚠ but a real counterparty is NOT reclassified as spam for not being replied to yet', () => {
  const v = classifyChat({
    handles: ['+18015550100'],
    messages: ['sending the PSA over', 'escrow opens Monday', 'title commitment attached'],
    sentByMe: 0,
    partyPhones: new Set(['8015550100']),
    recordTokens: new Map(),
    singleTokenRecords: new Set(),
    excludedHandles: new Set(),
  })
  assert.equal(v.business, true, 'a known party outranks the broadcast heuristic')
})

test('deal vocabulary alone needs volume, not one mention', () => {
  const one = chat(['can you send the invoice'])
  assert.equal(one.business, false, 'a single term is not a deal conversation')

  const many = chat([
    'the PSA and escrow are set, title commitment came back clean',
    'change order on the subcontract, and the retainage is held',
  ])
  assert.equal(many.business, true)
})

test('a deal-size figure counts but is not sufficient alone', () => {
  assert.equal(chat(['it was $1,250,000']).signals.bigMoney, true)
  assert.equal(chat(['it was $1,250,000']).business, false)
  assert.equal(chat(['dinner was $45']).signals.bigMoney, false)
})

test('nameTokens drops industry words and keeps place names', () => {
  assert.deepEqual(nameTokens('Delta Energy Partners LLC'), ['delta'])
  assert.deepEqual(nameTokens('The Development Company'), [])
  assert.ok(nameTokens('Myton Development').includes('myton'))
})

test('phone normalization agrees across formats', () => {
  for (const f of ['+1 (801) 555-0100', '8015550100', '1-801-555-0100', '801.555.0100']) {
    assert.equal(normalizePhone(f), '8015550100', f)
  }
  assert.equal(normalizePhone('55512'), null, 'a short code is not a phone number')
  assert.equal(normalizePhone('someone@example.com'), null)
})

test('⚠ an excluded number overrides EVERY other signal, including a known party', () => {
  // Eric's thread scores 5 on real deal vocabulary and a deal-size figure. It
  // is genuinely about the business AND it is 3,654 messages of internal
  // chatter, so no score can separate the two halves — only a named exclusion.
  const v = classifyChat({
    handles: ['+13854366519'],
    messages: [
      'sending the PSA, escrow opens Monday',
      'change order on the subcontract, $2,400,000 all in',
      'title commitment and the plat came back',
    ],
    sentByMe: 40,
    partyPhones: new Set(['3854366519']),
    recordTokens: new Map([['steelton', 'Steelton']]),
    singleTokenRecords: new Set(['Steelton']),
    excludedHandles: new Set(['3854366519']),
  })
  assert.equal(v.business, false)
  assert.equal(v.score, 0, 'an excluded thread is not even scored')
  assert.deepEqual(v.signals.namedRecords, [], 'and its bodies are never scanned')
  assert.match(v.reason, /excluded number/)
})

test('a GROUP chat containing an excluded number is excluded too', () => {
  const v = classifyChat({
    handles: ['+18015550100', '+13854366519'],
    messages: ['the PSA is signed', 'escrow opens Monday', 'invoice to follow'],
    sentByMe: 5,
    ...EMPTY,
    excludedHandles: new Set(['3854366519']),
  })
  assert.equal(v.business, false, 'any participant being excluded excludes the thread')
})

test('exclusion matches across phone formats', () => {
  for (const stored of ['+13854366519', '3854366519', '(385) 436-6519']) {
    const v = classifyChat({
      handles: [stored],
      messages: ['the PSA and escrow and title commitment and subcontract'],
      sentByMe: 3,
      ...EMPTY,
      excludedHandles: new Set(['3854366519']),
    })
    assert.equal(v.business, false, stored)
  }
})
