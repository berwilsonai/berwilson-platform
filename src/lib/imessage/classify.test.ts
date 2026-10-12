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
  rareTokens: new Set<string>(),
  excludedHandles: new Set<string>(),
  internalHandles: new Set<string>(),
}

type Input = Parameters<typeof classifyChat>[0]

/**
 * `total` defaults to the sample's own length.
 *
 * In a test the sample IS the whole conversation, so they are the same number.
 * They are not the same number in production — see ClassifyInput.total — which
 * is why the field exists and why this default is written down once.
 */
function verdict(
  input: Omit<Input, 'total' | 'tokensPerRecord'> & {
    total?: number
    tokensPerRecord?: Map<string, string[]>
  }
) {
  // Derived from recordTokens unless a test states it: the grouping is
  // mechanical, and restating it in every case would hide the one that matters.
  const derived = new Map<string, string[]>()
  for (const [token, label] of input.recordTokens) {
    derived.set(label, [...(derived.get(label) ?? []), token])
  }
  return classifyChat({
    ...input,
    tokensPerRecord: input.tokensPerRecord ?? derived,
    total: input.total ?? input.messages.length,
  })
}

function chat(messages: string[], over: Partial<Input> = {}) {
  return verdict({
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

test('a lone token names a record only when the corpus says that word is rare', () => {
  const recordTokens = new Map([['steelton', 'Steelton — Cleveland-Cliffs (PA)']])
  const without = chat(['heading to steelton tomorrow'], { recordTokens })
  assert.deepEqual(without.signals.namedRecords, [], 'one token, not certified rare')

  const with_ = chat(['heading to steelton tomorrow'], {
    recordTokens,
    rareTokens: new Set(['steelton']),
  })
  assert.deepEqual(with_.signals.namedRecords, ['Steelton — Cleveland-Cliffs (PA)'])
  assert.equal(with_.business, true)
})

test("⚠ a CRM contact alone is NOT enough — a contact can also be a friend", () => {
  // This used to clear the bar by itself, on the reasoning that a directory
  // entry is a human filing decision. Richard's instruction on 10-11 narrowed
  // it: "if the text isn't work related to ignore it." Being in the CRM says
  // who somebody is, not what this conversation is about.
  const social = chat(['ok', 'thanks'], {
    handles: ['+18015550100'],
    partyPhones: new Set(['8015550100']),
  })
  assert.equal(social.signals.knownParty, true)
  assert.equal(social.business, false)
  assert.match(social.reason, /nothing work-related/)

  // The same contact, talking about work, is admitted.
  const working = chat(['the PSA is signed and escrow opens Monday'], {
    handles: ['+18015550100'],
    partyPhones: new Set(['8015550100']),
  })
  assert.equal(working.business, true)
})

test('marketing written in deal vocabulary is still excluded', () => {
  // Verbatim shape from this corpus: insurance spam scores on terms alone.
  const v = verdict({
    handles: ['55512'],
    messages: ['Self Employed or Business Owner? You may qualify for new coverage. Invoice financing and bonding available.'],
    sentByMe: 0,
    ...EMPTY,
  })
  assert.equal(v.business, false)
  assert.match(v.reason, /short-code/)
})

test('a broadcast never replied to is excluded', () => {
  const v = verdict({
    handles: ['+18885551234'],
    messages: ['your bid is due', 'reminder: bid due', 'final notice on the bid'],
    sentByMe: 0,
    ...EMPTY,
  })
  assert.equal(v.business, false)
  assert.match(v.reason, /broadcast/)
})

test('⚠ but a real counterparty is NOT reclassified as spam for not being replied to yet', () => {
  const v = verdict({
    handles: ['+18015550100'],
    messages: ['sending the PSA over', 'escrow opens Monday', 'title commitment attached'],
    sentByMe: 0,
    partyPhones: new Set(['8015550100']),
    recordTokens: new Map(),
    rareTokens: new Set(),
    excludedHandles: new Set(),
    internalHandles: new Set(),
  })
  assert.equal(v.business, true, 'a known party outranks the broadcast heuristic')
})

test('⚠ deal vocabulary from a STRANGER is never enough, however much of it', () => {
  // The old rule scored vocabulary and admitted at two points, so "2 deal
  // terms; deal-size figure" took a 125-message thread with no record named and
  // nobody in the directory — indistinguishable from two friends buying a
  // house. Measured on the real corpus: this withheld 17 conversations, one of
  // them carrying NINE deal terms, and every one of them is a stranger.
  const many = chat([
    'the PSA and escrow are set, title commitment came back clean',
    'change order on the subcontract, and the retainage is held',
  ])
  assert.equal(many.business, false)
  assert.match(many.reason, /work vocabulary, but no record clearly named/)

  // One phone number on a contact record is what admits it.
  const withContact = chat(
    [
      'the PSA and escrow are set, title commitment came back clean',
      'change order on the subcontract, and the retainage is held',
    ],
    { handles: ['+18015550100'], partyPhones: new Set(['8015550100']) }
  )
  assert.equal(withContact.business, true)
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
  // The mechanism, kept for a number that must never be read. It is NOT what
  // Eric gets — see the internal tests below.
  const v = verdict({
    handles: ['+13854366519'],
    messages: [
      'sending the PSA, escrow opens Monday',
      'change order on the subcontract, $2,400,000 all in',
      'title commitment and the plat came back',
    ],
    sentByMe: 40,
    partyPhones: new Set(['3854366519']),
    recordTokens: new Map([['steelton', 'Steelton']]),
    rareTokens: new Set(['steelton']),
    excludedHandles: new Set(['3854366519']),
    internalHandles: new Set(),
  })
  assert.equal(v.business, false)
  assert.equal(v.score, 0, 'an excluded thread is not even scored')
  assert.deepEqual(v.signals.namedRecords, [], 'and its bodies are never scanned')
  assert.match(v.reason, /excluded number/)
})

test('a GROUP chat containing an excluded number is excluded too', () => {
  const v = verdict({
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
    const v = verdict({
      handles: [stored],
      messages: ['the PSA and escrow and title commitment and subcontract'],
      sentByMe: 3,
      ...EMPTY,
      excludedHandles: new Set(['3854366519']),
    })
    assert.equal(v.business, false, stored)
  }
})

test("⚠ a colleague's thread is INTERNAL, and internal is work — not a score", () => {
  // Eric is CEO of a two-person company; his texts are primarily work. He was
  // first SELECTED for scoring like a deal thread and then EXCLUDED for being
  // large and mixed — both wrong, because the axis was never how business the
  // vocabulary sounds. A thread with no deal word in it at all is still the
  // channel this company is run on.
  const v = verdict({
    handles: ['+13854366519'],
    messages: ['call me when you land', 'ok'],
    sentByMe: 20,
    ...EMPTY,
    internalHandles: new Set(['3854366519']),
  })
  // ⚠ AND IT IS A FLAG, NOT A DOOR. It used to return business:true with
  // score 99 before anything was scored. Richard asked for the same rule to
  // apply to Eric as to everyone — so a colleague's thread is admitted on its
  // merits, which his work threads clear by naming records. With no deal word
  // and no record in it, this one is private.
  assert.equal(v.internal, true, 'still flagged, because attribution downstream needs it')
  assert.equal(v.business, false)
})

test("a colleague's thread naming a record IS admitted, with no exception for being internal", () => {
  const v = verdict({
    handles: ['+13854366519'],
    messages: ['steelton closing moved to Nov 1, tell Tensor'],
    sentByMe: 20,
    ...EMPTY,
    recordTokens: new Map([['steelton', 'Steelton — Cleveland-Cliffs (PA)']]),
    rareTokens: new Set(['steelton']),
    internalHandles: new Set(['3854366519']),
  })
  assert.equal(v.business, true)
  assert.equal(v.internal, true)
  assert.match(v.reason, /internal/)
})

test('⚠ internal still beats the broadcast heuristic, though it no longer admits', () => {
  // `automated` fires on a thread never replied to inside the window, and
  // Eric's texting number is not on his contact record — so a quiet fortnight
  // would have had his thread thrown out as marketing before the rule ever ran.
  const v = verdict({
    handles: ['+13854366519'],
    messages: ['steelton closing moved to Nov 1', 'one more thing', 'and another'],
    sentByMe: 0,
    ...EMPTY,
    recordTokens: new Map([['steelton', 'Steelton — Cleveland-Cliffs (PA)']]),
    rareTokens: new Set(['steelton']),
    internalHandles: new Set(['3854366519']),
  })
  assert.equal(v.signals.automated, true, 'it does look like a broadcast')
  assert.equal(v.business, true, 'and a colleague is never one')
})

test('a MIXED group — colleague plus an outsider — is not internal', () => {
  // The flag governs attribution downstream: a commitment in a thread with an
  // outsider in it may legitimately be owed to that outsider, so the thread
  // must not be treated as two insiders talking.
  const v = verdict({
    handles: ['+13854366519', '+18015550100'],
    messages: ['sending the PSA, escrow opens Monday, title commitment attached'],
    sentByMe: 4,
    ...EMPTY,
    internalHandles: new Set(['3854366519']),
  })
  assert.equal(v.internal, false, 'one outsider makes it an external conversation')
})

test('an explicit exclusion outranks internal', () => {
  const v = verdict({
    handles: ['+13854366519'],
    messages: ['anything at all'],
    sentByMe: 5,
    ...EMPTY,
    internalHandles: new Set(['3854366519']),
    excludedHandles: new Set(['3854366519']),
  })
  assert.equal(v.business, false)
  assert.match(v.reason, /excluded number/)
})

test('⚠ two ordinary words of a LONG name are not a name match — the hospital/airport bug', () => {
  // Measured 2026-10-11 on the real corpus: a 664-message personal thread was
  // selected as the project "Stockton Power Nexus - ER Hospital & Medevac
  // Airport Tower" because **hospital** (8 chats) and **airport** (9 chats)
  // both appear in a year of family texts. A six-token name offers fifteen
  // pairs, so counting tokens makes a LONG name easier to match by accident
  // than a short one — the opposite of what counting implies.
  const label = 'Stockton Power Nexus - ER Hospital & Medevac Airport Tower'
  const recordTokens = new Map(
    ['stockton', 'nexus', 'hospital', 'medevac', 'airport', 'tower'].map((t) => [t, label] as const)
  )

  const accidental = chat(['im at the airport now', 'dad is out of the hospital'], { recordTokens })
  assert.deepEqual(accidental.signals.namedRecords, [], 'two ordinary words is not the record')
  assert.equal(accidental.business, false)

  // The same thread naming the distinguishing word IS the record.
  const real = chat(['medevac tower spec came back'], {
    recordTokens,
    rareTokens: new Set(['medevac']),
  })
  assert.deepEqual(real.signals.namedRecords, [label])
})

test('⚠ but the WHOLE name is a match, however ordinary its words — Myton Rail', () => {
  // The mirror of the bug above, and why the fix cannot simply be "require a
  // rare word": `myton` (9 chats) and `rail` (4) are both too common to name a
  // record alone, yet together they are the record's entire name rather than
  // two words out of it.
  const recordTokens = new Map([
    ['myton', 'Myton Rail'],
    ['rail', 'Myton Rail'],
  ])
  const v = chat(['myton rail alignment is approved'], { recordTokens })
  assert.deepEqual(v.signals.namedRecords, ['Myton Rail'])
  assert.equal(v.business, true)
})

test('⚠ coverage is counted over SURVIVING tokens, and one of them is still not enough', () => {
  // `Case Garage` keeps its lesson under the new rule: `case` is dropped as
  // ordinary by the calibration, so the record survives as `garage` alone —
  // and a one-token name must earn it on rarity, never on covering itself.
  const v = chat(['put it in the garage'], {
    recordTokens: new Map([['garage', 'Case Garage']]),
    tokensPerRecord: new Map([['Case Garage', ['garage']]]),
  })
  assert.deepEqual(v.signals.namedRecords, [], 'a lone surviving token is not full coverage')
})

test('a record named by a rare word plus ordinary ones still matches', () => {
  // McCleery Real Estate Premier: `premier` appears in 1 conversation, so it
  // identifies the record whether or not the rest of the name landed.
  const label = 'McCleery Real Estate Premier'
  const recordTokens = new Map(
    ['mccleery', 'premier', 'estate'].map((t) => [t, label] as const)
  )
  const v = chat(['premier sent the estate docs'], { recordTokens, rareTokens: new Set(['premier']) })
  assert.deepEqual(v.signals.namedRecords, [label])
})
