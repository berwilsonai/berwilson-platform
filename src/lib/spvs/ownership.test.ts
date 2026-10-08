/**
 * Our share of a vehicle has one definition, and an unfinished ledger must
 * never read as a finished one.
 *
 * Every case here is a number that would otherwise reach a screen as a fact
 * about the deal: a guessed residue, a $0 that means "nobody said", a 100%
 * that means "nobody has decided".
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  effectiveSpvStatus,
  participantTotals,
  resolveBwShare,
  splitWarnings,
  stillToPlace,
  summarizePipeline,
  type Commitment,
} from './ownership'
import type { ProjectSpv, SpvParticipant } from './types'

function participant(over: Partial<SpvParticipant> = {}): SpvParticipant {
  return {
    id: over.id ?? 'p1',
    spvId: 'spv1',
    holderName: 'A Partner',
    holderPartyId: null,
    holderEntityId: null,
    investorId: null,
    isBerWilson: false,
    role: 'capital_partner',
    class: 'membership_units',
    equityPct: null,
    capitalCommitted: null,
    capitalFunded: null,
    preferredReturnPct: null,
    profitSharePct: null,
    status: 'planning_assumption',
    note: null,
    sortOrder: 0,
    ...over,
  }
}

function spv(over: Partial<ProjectSpv> = {}): ProjectSpv {
  return {
    id: 'spv1',
    label: 'Myton Energy LLC',
    purpose: 'energy',
    entityId: null,
    orgNodeId: null,
    orgNodeName: null,
    jurisdiction: null,
    bwOwnershipPct: null,
    raiseTarget: null,
    status: 'planning_assumption',
    note: null,
    sortOrder: 0,
    participants: [],
    ...over,
  }
}

// ── which of the two homes answers ──────────────────────────────────────────

test('with no participants, the typed share stands and says so', () => {
  const share = resolveBwShare(spv({ bwOwnershipPct: 51 }), [])
  assert.equal(share.pct, 51)
  assert.equal(share.from, 'typed')
  assert.equal(share.typedSuperseded, false)
})

test('with no participants and nothing typed, the share is undetermined — not 0, not 100', () => {
  const share = resolveBwShare(spv(), [])
  assert.equal(share.pct, null)
  assert.equal(share.from, 'none')
})

test('the ledger wins over a typed share, and the typed one is reported as superseded', () => {
  const share = resolveBwShare(spv({ bwOwnershipPct: 51 }), [
    participant({ id: 'bw', isBerWilson: true, equityPct: 40 }),
    participant({ id: 'av', equityPct: 60 }),
  ])
  assert.equal(share.pct, 40)
  assert.equal(share.from, 'ledger')
  assert.equal(share.typedSuperseded, true, 'the typed figure must be shown as ignored, not dropped silently')
})

test('a ledger with no Ber Wilson row is UNDETERMINED, never the residue of the others', () => {
  const share = resolveBwShare(spv(), [
    participant({ id: 'av', equityPct: 35 }),
    participant({ id: 'el', equityPct: 25 }),
  ])
  // 100 - 60 = 40 would be a confident figure invented from a half-entered
  // cap table, which is the normal state of a live negotiation.
  assert.equal(share.pct, null)
  assert.equal(share.from, 'none')
})

test('a Ber Wilson row with no equity set is undetermined, not 0', () => {
  const share = resolveBwShare(spv({ bwOwnershipPct: 51 }), [
    participant({ id: 'bw', isBerWilson: true, equityPct: null }),
  ])
  assert.equal(share.pct, null)
  assert.equal(share.from, 'none')
})

// ── totals: absent is not zero ──────────────────────────────────────────────

test('a total with nothing in it is NULL, not 0', () => {
  const totals = participantTotals([participant(), participant({ id: 'p2' })])
  assert.equal(totals.equityPct, null, '$0/0% on screen would read as computed rather than unfinished')
  assert.equal(totals.committed, null)
  assert.equal(totals.funded, null)
  assert.equal(totals.withEquity, 0)
})

test('totals sum only the rows that carry a figure, and count them', () => {
  const totals = participantTotals([
    participant({ id: 'bw', isBerWilson: true, equityPct: 40 }),
    participant({ id: 'av', equityPct: 35, capitalCommitted: 14_000_000, capitalFunded: 4_000_000 }),
    participant({ id: 'el', equityPct: 25, capitalCommitted: 10_000_000 }),
  ])
  assert.equal(totals.equityPct, 100)
  assert.equal(totals.committed, 24_000_000)
  assert.equal(totals.funded, 4_000_000)
  assert.equal(totals.withEquity, 3)
  assert.equal(totals.withCommitted, 2)
  assert.equal(totals.withFunded, 1, 'two of three have not funded — the count is how the screen says so')
})

test('floating-point equity sums land exactly on 100', () => {
  const totals = participantTotals([
    participant({ id: 'a', equityPct: 33.3333 }),
    participant({ id: 'b', equityPct: 33.3333 }),
    participant({ id: 'c', equityPct: 33.3334 }),
  ])
  assert.equal(totals.equityPct, 100)
})

test('still-to-place needs BOTH a target and a total, or it is unknown', () => {
  assert.equal(stillToPlace(40_000_000, 24_000_000), 16_000_000)
  assert.equal(stillToPlace(null, 24_000_000), null, 'no target means no gap, not a gap of the whole commitment')
  assert.equal(stillToPlace(40_000_000, null), null)
})

// ── warnings report, never block ────────────────────────────────────────────

test('an empty ledger raises nothing — a vehicle with no participants is not wrong', () => {
  assert.deepEqual(splitWarnings(spv({ bwOwnershipPct: 51 }), []), [])
})

test('splits that total 100 raise nothing', () => {
  const warnings = splitWarnings(spv(), [
    participant({ id: 'bw', isBerWilson: true, equityPct: 40 }),
    participant({ id: 'av', equityPct: 35 }),
    participant({ id: 'el', equityPct: 25 }),
  ])
  assert.deepEqual(warnings, [])
})

test('splits under 100 name the unassigned remainder', () => {
  const warnings = splitWarnings(spv(), [
    participant({ id: 'bw', isBerWilson: true, equityPct: 40 }),
    participant({ id: 'av', equityPct: 35 }),
    participant({ id: 'el', equityPct: 10 }),
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /total 85%/)
  assert.match(warnings[0], /15% is unassigned/)
})

test('splits over 100 say so in those terms, not as a negative remainder', () => {
  const warnings = splitWarnings(spv(), [
    participant({ id: 'bw', isBerWilson: true, equityPct: 60 }),
    participant({ id: 'av', equityPct: 45 }),
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /105%/)
  assert.match(warnings[0], /5% more than the whole vehicle/)
})

test('a ledger with no Ber Wilson row says the revenue reads as undetermined', () => {
  const warnings = splitWarnings(spv(), [participant({ id: 'av', equityPct: 100 })])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /No participant .* is marked as Ber Wilson/)
})

test('participants with no splits at all are named as undetermined, not as 0%', () => {
  const warnings = splitWarnings(spv(), [participant(), participant({ id: 'p2' })])
  assert.ok(warnings.some((w) => /no equity split on any of them/.test(w)))
  assert.ok(!warnings.some((w) => /total 0%/.test(w)), 'a missing split is not a zero one')
})

test('a typed share disagreeing with the ledger is called out with both numbers', () => {
  const warnings = splitWarnings(spv({ bwOwnershipPct: 51 }), [
    participant({ id: 'bw', isBerWilson: true, equityPct: 40 }),
    participant({ id: 'av', equityPct: 60 }),
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /typed share of 51%/)
  assert.match(warnings[0], /ledger that says 40%/)
})

test('an oversubscribed raise is reported, because the usual cause is the wrong vehicle', () => {
  const warnings = splitWarnings(spv({ raiseTarget: 20_000_000 }), [
    participant({ id: 'bw', isBerWilson: true, equityPct: 40 }),
    participant({ id: 'av', equityPct: 60, capitalCommitted: 24_000_000 }),
  ])
  assert.ok(warnings.some((w) => /more committed than its raise target/.test(w)))
})

test('a vehicle with no label falls back to its purpose in the sentence', () => {
  const warnings = splitWarnings(spv({ label: '' }), [participant({ id: 'av', equityPct: 50 })])
  assert.ok(warnings.some((w) => w.startsWith('Energy ')))
})

// ── the weakest status wins ─────────────────────────────────────────────────

test("a contracted vehicle is only as strong as its weakest participant", () => {
  const status = effectiveSpvStatus({ status: 'contracted' }, [
    participant({ id: 'bw', status: 'contracted' }),
    participant({ id: 'av', status: 'planning_assumption' }),
  ])
  assert.equal(status, 'planning_assumption', 'reading the vehicle alone launders the partner nobody has agreed with')
})

test('a vehicle with no participants reports its own status', () => {
  assert.equal(effectiveSpvStatus({ status: 'loi_term_sheet' }, []), 'loi_term_sheet')
})

// ── the raise pipeline, kept apart from the cap table ───────────────────────
//
// `investments` and `project_spv_participants` both held equity/committed/
// funded with nothing naming which was the record. These tests pin the one
// property that keeps them honest: the two are reported side by side and are
// never added together.

function commitment(over: Partial<Commitment> = {}): Commitment {
  return { investorId: 'inv-1', indicated: null, committed: null, funded: null, ...over }
}

test('no commitments is an empty pipeline, with null totals rather than zeros', () => {
  const pipeline = summarizePipeline([], [])
  assert.equal(pipeline.investorCount, 0)
  assert.equal(pipeline.committed, null, '"$0 signed" would be a claim about the raise')
  assert.equal(pipeline.funded, null)
})

test('one investor with two cheques is ONE investor, not two', () => {
  // A first cheque and a follow-on are two rows against the same vehicle, and
  // "how many people are in this raise" is a figure read out loud.
  const pipeline = summarizePipeline(
    [
      commitment({ investorId: 'inv-1', committed: 2_000_000 }),
      commitment({ investorId: 'inv-1', committed: 1_000_000 }),
    ],
    []
  )
  assert.equal(pipeline.investorCount, 1)
  assert.equal(pipeline.committed, 3_000_000, 'the money still adds up')
})

test('a pipeline total is null until a row carries that figure', () => {
  const pipeline = summarizePipeline([commitment({ indicated: 5_000_000 })], [])
  assert.equal(pipeline.indicated, 5_000_000)
  assert.equal(pipeline.committed, null, 'indicated is not committed')
  assert.equal(pipeline.funded, null)
})

test('an investor already on the cap table is counted as such', () => {
  const pipeline = summarizePipeline(
    [
      commitment({ investorId: 'inv-1', committed: 1_000_000 }),
      commitment({ investorId: 'inv-2', committed: 2_000_000 }),
    ],
    [{ investorId: 'inv-1' }, { investorId: null }]
  )
  assert.equal(pipeline.investorCount, 2)
  assert.equal(pipeline.onCapTable, 1, 'so the screen can say "1 of 2 not on the cap table"')
})

test('a ledger row with no investor link never matches a pipeline row', () => {
  // `investor_id` is a nullable seam: a holder entered by hand has none, and
  // matching on name instead is what this flag exists to avoid.
  const pipeline = summarizePipeline([commitment({ investorId: 'inv-9' })], [{ investorId: null }])
  assert.equal(pipeline.onCapTable, 0)
})

test('the pipeline total and the ledger total stay separate quantities', () => {
  // The regression this whole split exists to prevent: the same investor is in
  // the pipeline at $2M AND on the cap table at $2M. That is ONE $2M, so any
  // reader adding the two reports a $4M raise that does not exist.
  const participants = [
    { investorId: 'inv-1', equityPct: 25, capitalCommitted: 2_000_000, capitalFunded: null },
  ]
  const pipeline = summarizePipeline(
    [commitment({ investorId: 'inv-1', committed: 2_000_000 })],
    participants
  )
  const ledger = participantTotals(participants)
  assert.equal(pipeline.committed, 2_000_000)
  assert.equal(ledger.committed, 2_000_000)
  assert.equal(pipeline.onCapTable, 1, 'the overlap is reported, which is what stops the sum')
  assert.notEqual(pipeline.committed! + ledger.committed!, 2_000_000)
})

// ── the warning must be true of the record ──────────────────────────────────
//
// `splitWarnings` tested `share.pct == null` and printed "no participant is
// marked as Ber Wilson" — true in only one of the two cases that condition
// covers. Found by seeding the Delta vehicles: a correctly flagged sponsor row
// with no percentage yet was told its flag was missing.

test('a flagged Ber Wilson row with no split is NOT reported as unflagged', () => {
  const warnings = splitWarnings(spv(), [
    participant({ holderName: 'Ber Wilson Corporation', isBerWilson: true, equityPct: null }),
  ])
  assert.ok(
    !warnings.some((w) => w.includes('No participant')),
    `claimed the flag was missing: ${JSON.stringify(warnings)}`
  )
})

test('and it is not told twice that the same split is missing', () => {
  // Two sentences about one gap is how a warning list stops being read.
  const warnings = splitWarnings(spv(), [
    participant({ holderName: 'Ber Wilson Corporation', isBerWilson: true, equityPct: null }),
  ])
  assert.equal(warnings.length, 1, JSON.stringify(warnings))
  assert.ok(warnings[0].includes('no equity split on any of them'))
})

test('a vehicle with genuinely no Ber Wilson row still says so', () => {
  const warnings = splitWarnings(spv(), [
    participant({ holderName: 'Partner A', isBerWilson: false, equityPct: 60 }),
    participant({ holderName: 'Partner B', isBerWilson: false, equityPct: 40 }),
  ])
  assert.ok(warnings.some((w) => w.includes('No participant')), JSON.stringify(warnings))
})

test('a flagged row with no split, beside others that HAVE splits, is called out by name', () => {
  // This is the case worth a sentence of its own: the others add to 65%, and
  // our share is undetermined rather than the 35% remainder.
  const warnings = splitWarnings(spv(), [
    participant({ holderName: 'Ber Wilson Corporation', isBerWilson: true, equityPct: null }),
    participant({ holderName: 'Capital Partner', isBerWilson: false, equityPct: 65 }),
  ])
  assert.ok(
    warnings.some((w) => w.includes('Ber Wilson Corporation') && w.includes('no equity split')),
    JSON.stringify(warnings)
  )
  assert.ok(
    warnings.some((w) => w.includes('unassigned')),
    'and the 35% gap is still reported'
  )
})
