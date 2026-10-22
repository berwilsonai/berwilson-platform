/**
 * The figure guard: every money and percentage figure in a composed document
 * must already appear in what the model was given.
 *
 * This is the test that matters most in the compose pass. The model is
 * measurably bad at arithmetic — handed a 69-row claim schedule it answered 62 —
 * and the documents it writes here include offers to purchase. A number it
 * computed is the most expensive error the system can make, so the cases below
 * are written as the failures they are meant to prevent.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  collectAllowedFigures,
  figureBlock,
  readFigures,
  unsourcedFigures,
  unsourcedMessage,
  type PlatformFigure,
} from './figures'

const noFigures: PlatformFigure[] = []

function allow(opts: { instructions?: string; evidence?: string; platform?: PlatformFigure[] }) {
  return collectAllowedFigures({
    instructions: opts.instructions ?? '',
    evidenceText: opts.evidence ?? '',
    platform: opts.platform ?? noFigures,
  })
}

test('reads money in every shape the corpus writes it', () => {
  const found = readFigures(
    'We paid $135,000,000 at closing, held $4.2M back, and reserved $500k plus $1.9 billion later.'
  )
  assert.deepEqual(found.money.sort((a, b) => a - b), [
    500_000,
    4_200_000,
    135_000_000,
    1_900_000_000,
  ])
})

test('reads percentages written both ways', () => {
  const found = readFigures('a 4% broker fee, capped at 9.0 percent')
  assert.deepEqual(found.percent.sort((a, b) => a - b), [4, 9])
})

test('a bare number with no currency marker is NOT a money figure', () => {
  // Deliberate: 327 acres, a 2026 date and a parcel number are all bare
  // numbers, and gating them would refuse honest documents constantly. §12 —
  // narrow a static check until it has no false positives.
  const found = readFigures('327 acres across parcel 00-0031-0042 in 2026')
  assert.deepEqual(found.money, [])
  assert.deepEqual(found.percent, [])
})

test('a figure quoted from the evidence passes', () => {
  const allowed = allow({ evidence: 'The PSA states a purchase price of $135,000,000.' })
  assert.deepEqual(unsourcedFigures('We offer $135M at closing.', allowed), [])
})

test('the same figure passes however the model reformats it', () => {
  // $135M, $135 million and $135,000,000 are one number. Comparing strings
  // would refuse a document for formatting its own source differently.
  const allowed = allow({ evidence: 'price of $135M' })
  for (const written of ['$135,000,000', '$135 million', '$135M', '$ 135M']) {
    assert.deepEqual(
      unsourcedFigures(`We offer ${written}.`, allowed),
      [],
      `${written} should be allowed`
    )
  }
})

test('A SUM THE MODEL COMPUTED IS REFUSED — the whole point of the guard', () => {
  // The inputs hold $120M and $15M. $135M appears nowhere. This is exactly the
  // failure mode: plausible, arithmetically correct, and invented.
  const allowed = allow({ evidence: '$120M at closing and a $15M holdback' })
  const offenders = unsourcedFigures('Total consideration is $135M.', allowed)
  assert.equal(offenders.length, 1)
  assert.equal(offenders[0].value, 135_000_000)
  assert.equal(offenders[0].kind, 'money')
})

test('an invented percentage is refused', () => {
  const allowed = allow({ evidence: 'a 4% broker fee' })
  const offenders = unsourcedFigures('We propose a 6.5% fee.', allowed)
  assert.equal(offenders.length, 1)
  assert.equal(offenders[0].value, 6.5)
  assert.equal(offenders[0].kind, 'percent')
})

test("the human's own instruction authorises a figure", () => {
  // This is what makes the refusal recoverable rather than a dead end: the way
  // to get a number into a document is to say it.
  const allowed = allow({
    instructions: 'Offer $4.2M at closing with a 10% deposit.',
    evidence: 'no figures here',
  })
  assert.deepEqual(unsourcedFigures('We offer $4.2M with a 10% deposit.', allowed), [])
})

test('a platform figure is allowed and carries its definition to the model', () => {
  const platform: PlatformFigure[] = [
    {
      label: 'Ber Wilson capture',
      amount: 26_250_000,
      kind: 'money',
      definition: 'net of SPV ownership',
    },
  ]
  const allowed = allow({ platform })
  assert.deepEqual(unsourcedFigures('Our capture is $26,250,000.', allowed), [])

  const block = figureBlock(platform)
  assert.match(block, /Ber Wilson capture/)
  assert.match(block, /\$26,250,000/)
  // §12: a money figure must carry its SHAPE. A bare total is how a capture
  // figure ends up in a document calling itself contract value.
  assert.match(block, /net of SPV ownership/)
})

test('with no figures on file the model is told to mark gaps, not estimate', () => {
  const block = figureBlock([])
  assert.match(block, /NO FIGURES ARE ON FILE/)
  assert.match(block, /TO BE AGREED/)
  assert.match(block, /Do not estimate/)
})

test('zero is never evidence of arithmetic', () => {
  const allowed = allow({ evidence: 'nothing numeric' })
  assert.deepEqual(unsourcedFigures('There is no fee: $0, and 0% carried.', allowed), [])
})

test('a floating-point multiply does not cause a false refusal', () => {
  // 1.2 * 1_000_000 is not exactly 1200000 in binary floating point, and a
  // guard that refuses a document over a rounding artefact gets switched off.
  const allowed = allow({ evidence: 'a $1.2M bridge' })
  assert.deepEqual(unsourcedFigures('the $1,200,000 bridge', allowed), [])
})

test('each offending figure is reported once, however often it appears', () => {
  const allowed = allow({ evidence: 'nothing' })
  const offenders = unsourcedFigures('$9M here, $9M there, and $9M again.', allowed)
  assert.equal(offenders.length, 1)
})

test('the refusal names the figures and says how to authorise one', () => {
  const allowed = allow({ evidence: 'nothing' })
  const offenders = unsourcedFigures('We offer $135M.', allowed)
  const message = unsourcedMessage(offenders)
  // "I could not source $135M" is actionable; "refused" is not.
  assert.match(message, /\$135M/)
  assert.match(message, /instructions/)
  assert.ok(!message.includes('undefined'))
  assert.ok(!message.includes('NaN'))
})

test('many offenders are summarised rather than dumped', () => {
  const allowed = allow({ evidence: 'nothing' })
  const body = Array.from({ length: 12 }, (_, i) => `$${i + 1}M`).join(', ')
  const offenders = unsourcedFigures(body, allowed)
  assert.equal(offenders.length, 12)
  assert.match(unsourcedMessage(offenders), /and 4 more/)
})
