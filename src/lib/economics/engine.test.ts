/**
 * Everything the brief's acceptance tests do not reach: the five line types
 * added for Ber Wilson's actual business, the reference graph, SPV ownership,
 * unit conversion, and the warnings.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeDealEconomics, emptyDealEconomics } from './compute'
import { rampFactor } from './schedule'
import { bucket, closeTo, deal, line, source, spv } from './testing'
import { capacityPricePerKwMonth, energyPricePerKwh, impliedAverageMw } from './units'
import { weakestStatus } from './provenance'

// ───────────────────────────────────────────────────── the five new line types

test('environmental attributes ride on an energy line and draw zero megawatts', () => {
  const b = bucket({ label: 'Surplus for external sale' })
  const energy = line('energy_sale', {
    label: 'Power sale',
    mw: 100,
    loadFactor: 0.9,
    price: 0.06,
    bucketId: b.id,
    termYears: 20,
  })
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 150 })],
      buckets: [b],
      lines: [
        energy,
        line('energy_attribute', {
          label: 'RECs',
          ridesOnLineId: energy.id,
          pricePerMwh: 12,
          attributeKind: 'REC',
          termYears: 20,
        }),
      ],
    })
  )

  const recs = result.lines[1]
  // 100 MW x 8760 x 0.9 = 788,400 MWh, at $12 = $9,460,800.
  assert.equal(recs.annualEnergyMwh, 788_400)
  assert.equal(recs.annualRevenue, 9_460_800)
  // ⚠ The same electrons already drew once. A second claim would be rejected.
  assert.equal(recs.facilityMw, 0)
  assert.equal(result.ledger.allocatedMw, 100, 'only the energy line allocates')
  assert.equal(result.valid, true)
})

test('per-unit one-time covers homes, tons and square feet with one type', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('one_time_per_unit', {
          label: 'Workforce housing',
          quantity: 80,
          pricePerUnit: 420_000,
          unitLabel: 'homes',
        }),
        line('one_time_per_unit', {
          label: 'Prefab steel supply',
          quantity: 1_250_000,
          pricePerUnit: 33,
          unitLabel: 'square feet',
        }),
      ],
    })
  )

  assert.equal(result.lines[0].oneTimeValue, 33_600_000)
  assert.equal(result.lines[1].oneTimeValue, 41_250_000)
  assert.equal(result.tiers.berWilsonGross.oneTimeRevenue, 74_850_000)
  assert.equal(result.valid, true)
})

test('a per-unit line with no unit label says so rather than printing a bare number', () => {
  const result = computeDealEconomics(
    deal({
      lines: [line('one_time_per_unit', { quantity: 80, pricePerUnit: 420_000 })],
    })
  )
  assert.ok(
    result.missing.some((m) => m.what.includes('What the unit is')),
    'the reader is told the figure cannot be read without its unit'
  )
})

test('a tax credit is money and is not revenue', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('tax_credit', {
          label: 'Section 48E investment credit',
          amount: 240_000_000,
          kind: '48E',
          transferable: true,
          ourSharePct: 100,
        }),
      ],
    })
  )

  const credit = result.lines[0]
  assert.equal(credit.countsAsRevenue, false)
  assert.equal(credit.taxCreditValue, 240_000_000)
  // ⚠ It reaches deal size without inflating any revenue figure.
  assert.equal(result.tiers.berWilsonGross.taxCredits, 240_000_000)
  assert.equal(result.tiers.berWilsonGross.oneTimeRevenue, null, 'a credit is not revenue')
})

test('a syndicated tax credit reports only our share', () => {
  const result = computeDealEconomics(
    deal({
      lines: [line('tax_credit', { amount: 240_000_000, kind: '48E', ourSharePct: 25 })],
    })
  )
  assert.equal(result.lines[0].taxCreditValue, 60_000_000)
})

test('an O&M agreement is priced on capacity and consumes none of it', () => {
  const b = bucket({ label: 'Anchor and critical load' })
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 250 })],
      buckets: [b],
      lines: [
        line('om_service', {
          label: 'Microgrid O&M',
          mw: 200,
          price: 18,
          priceUnit: 'per_kw_year',
          termYears: 20,
          counterparty: 'City of Helper',
        }),
      ],
    })
  )
  // 200 MW is 200,000 kW at $18/kW-year = $3.6M a year.
  assert.equal(result.lines[0].annualRevenue, 3_600_000)
  // ⚠ Maintaining a 200 MW plant does not take 200 MW off that plant. Treating
  // it as a draw double-books the generation against itself: a full campus
  // model showed 290 MW allocated against 225 MW firm on this one mistake.
  assert.equal(result.lines[0].facilityMw, 0)
  assert.equal(result.ledger.allocatedMw, 0)
  assert.equal(result.valid, true, 'and it needs no bucket, so nothing is orphaned')
})

test('a recurring fee can be charged against a capital base with no referenced line', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('recurring_fee_on_line', {
          label: 'Asset management fee',
          base: 'capital_base',
          capitalBase: 1_000_000_000,
          annualRatePct: 0.75,
          ourSharePct: 100,
          termYears: 10,
        }),
      ],
    })
  )
  assert.equal(result.lines[0].annualRevenue, 7_500_000)
  assert.equal(result.valid, true)
})

test('land sells by the acre, and powered land priced per MW allocates those MW', () => {
  const b = bucket({ label: 'Development load' })
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 500 })],
      buckets: [b],
      lines: [
        line('land', {
          label: 'Surplus acreage',
          disposition: 'sale',
          acres: 640,
          price: 18_000,
          priceUnit: 'per_acre',
        }),
        line('land', {
          label: 'Powered land sale',
          disposition: 'sale',
          mw: 120,
          price: 1_200_000,
          priceUnit: 'per_mw',
          bucketId: b.id,
        }),
      ],
    })
  )

  assert.equal(result.lines[0].oneTimeValue, 11_520_000)
  assert.equal(result.lines[0].facilityMw, 0, 'acreage draws no capacity')
  assert.equal(result.lines[1].oneTimeValue, 144_000_000)
  assert.equal(result.lines[1].facilityMw, 120, 'powered land allocates its megawatts')
  assert.equal(result.ledger.allocatedMw, 120)
  assert.equal(result.valid, true)
})

test('a land lease is recurring rent, not a one-time sale', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('land', {
          disposition: 'lease',
          annualRent: 480_000,
          escalatorPct: 2.5,
          termYears: 30,
        }),
      ],
      discountRatePct: 9,
    })
  )
  const lease = result.lines[0]
  assert.equal(lease.shape, 'recurring')
  assert.equal(lease.annualRevenue, 480_000)
  assert.ok((lease.contractValue ?? 0) > 480_000 * 30, 'escalation lifts it above flat rent')
  assert.ok(lease.npv != null && lease.npv < (lease.contractValue ?? 0))
})

// ───────────────────────────────────────────────── empty means empty, not zero

test('a subscription price with no unit count produces no number', () => {
  const result = computeDealEconomics(
    deal({ lines: [line('subscription', { pricePerUnitMonth: 95, unitLabel: 'resident' })] })
  )
  assert.equal(result.lines[0].annualRevenue, null, 'null, never zero')
  assert.ok(result.missing.some((m) => m.what === 'Number of units'))
  assert.equal(
    result.tiers.berWilsonGross.annualRecurringRevenue,
    null,
    'the tier is null too: nothing contributed, so there is nothing to show'
  )
})

test('the engine invents no defaults anywhere', () => {
  const blank = emptyDealEconomics()
  assert.equal(blank.discountRatePct, null)
  assert.equal(blank.capRatePct, null)
  assert.equal(blank.baseYear, null)
  assert.equal(blank.statedTotal, null)
  assert.deepEqual(blank.lines, [])

  const energy = line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.08, termYears: 20 })
  const result = computeDealEconomics(deal({ lines: [energy] }))
  assert.equal(result.lines[0].npv, null, 'no discount rate means no NPV, not a guessed one')
  assert.ok(result.missing.some((m) => m.what.includes('discount rate')))
})

test('a recurring line with no term reports its annual figure and no contract value', () => {
  const result = computeDealEconomics(
    deal({ lines: [line('capacity_charge', { mw: 50, price: 12 })] })
  )
  assert.equal(result.lines[0].annualRevenue, 7_200_000)
  assert.equal(result.lines[0].contractValue, null)
  assert.ok(result.missing.some((m) => m.what.includes('Term in years')))
})

// ─────────────────────────────────────────────────────── the reference graph

test('a reference cycle is an invalid model that names both lines', () => {
  const a = line('fee_margin', { label: 'Fee A', pctOfLine: 10 })
  const b = line('fee_margin', { label: 'Fee B', pctOfLine: 10 })
  a.referencedLineId = b.id
  b.referencedLineId = a.id

  const result = computeDealEconomics(deal({ lines: [a, b] }))
  assert.equal(result.valid, false)
  const cycles = result.errors.filter((e) => e.code === 'reference_cycle')
  assert.equal(cycles.length, 2, 'both lines in the cycle are named')
  assert.ok(cycles.some((e) => e.message.includes('Fee A')))
  assert.ok(cycles.some((e) => e.message.includes('Fee B')))
})

test('a fee pointing at a line that is not in the model is an error, not a zero', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('fee_margin', { label: 'Orphan fee', referencedLineId: 'nope', pctOfLine: 12 }),
      ],
    })
  )
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.code === 'missing_reference'))
})

test('a fee evaluates after the line it references, whatever order they are entered', () => {
  const epc = line('one_time_lump', { label: 'Build', amount: 100_000_000 })
  const fee = line('fee_margin', {
    label: 'Developer fee',
    referencedLineId: epc.id,
    pctOfLine: 5,
    isCarveOut: true,
  })
  // Fee entered FIRST, so only a topological pass gets this right.
  const result = computeDealEconomics(deal({ lines: [fee, epc] }))
  assert.equal(result.lines[0].oneTimeValue, 5_000_000)
  assert.equal(result.lines[0].label, 'Developer fee', 'the author order is kept on screen')
})

test('a fee on a recurring line is taken on its contract value', () => {
  const lease = line('dc_lease', {
    label: 'Turnkey lease',
    itMw: 10,
    ratePerKwMonth: 140,
    occupancy: 1,
    pue: 1.3,
    termYears: 10,
  })
  const result = computeDealEconomics(
    deal({
      lines: [
        lease,
        line('fee_margin', {
          label: 'Asset management',
          referencedLineId: lease.id,
          pctOfLine: 2,
          isCarveOut: true,
        }),
      ],
      buckets: [],
    })
  )
  const contract = result.lines[0].contractValue ?? 0
  assert.ok(closeTo(result.lines[1].oneTimeValue ?? 0, contract * 0.02, 1e-9))
})

// ──────────────────────────────────────────────────────────── SPV ownership

test('an unknown ownership split is undetermined, never 100%', () => {
  const energySpv = spv({ label: 'Helper Energy LLC', purpose: 'energy', bwOwnershipPct: 60 })
  const dcSpv = spv({ label: 'Helper Data Center LLC', purpose: 'data_center' })
  const result = computeDealEconomics(
    deal({
      spvs: [energySpv, dcSpv],
      lines: [
        line('capacity_charge', {
          label: 'Capacity',
          mw: 100,
          price: 10,
          termYears: 10,
          spvId: energySpv.id,
        }),
        line('dc_lease', {
          label: 'Lease',
          itMw: 20,
          ratePerKwMonth: 150,
          occupancy: 1,
          pue: 1.3,
          termYears: 10,
          spvId: dcSpv.id,
        }),
      ],
    })
  )

  assert.equal(result.tiers.berWilsonGross.annualRecurringRevenue, 12_000_000 + 36_000_000)
  // Only the vehicle with a known split reaches net, and at 60%.
  assert.equal(result.tiers.berWilsonNet.annualRecurringRevenue, 12_000_000 * 0.6)
  // ⚠ The data center lease is NOT in net at full value. It is undetermined.
  assert.equal(result.tiers.undetermined.annualRecurringRevenue, 36_000_000)
  assert.equal(result.tiers.ownershipComplete, false)
  assert.deepEqual(
    result.tiers.spvsMissingOwnership.map((s) => s.label),
    ['Helper Data Center LLC']
  )

  const warning = result.warnings.find((w) => w.code === 'ownership_unset')
  assert.ok(warning)
  assert.ok(warning.message.includes('Helper Data Center LLC'), warning.message)
})

test('a line with no SPV is the parent company and is wholly ours', () => {
  const result = computeDealEconomics(
    deal({ lines: [line('one_time_lump', { amount: 5_000_000 })] })
  )
  assert.equal(result.tiers.berWilsonNet.oneTimeRevenue, 5_000_000)
  assert.equal(result.tiers.ownershipComplete, true)
})

test('the same figures break out by the vehicle that earns them', () => {
  const land = spv({ label: 'Land LLC', purpose: 'land', bwOwnershipPct: 100 })
  const energy = spv({ label: 'Energy LLC', purpose: 'energy', bwOwnershipPct: 50 })
  const result = computeDealEconomics(
    deal({
      spvs: [land, energy],
      lines: [
        line('land', { disposition: 'sale', acres: 100, price: 20_000, spvId: land.id }),
        line('capacity_charge', { mw: 50, price: 10, termYears: 5, spvId: energy.id }),
      ],
    })
  )

  const byLabel = new Map(result.byEntity.map((e) => [e.label, e]))
  assert.equal(byLabel.get('Land LLC')?.gross.oneTimeRevenue, 2_000_000)
  assert.equal(byLabel.get('Energy LLC')?.bwOwnershipPct, 50)
  assert.equal(
    byLabel.get('Energy LLC')?.berWilsonNet?.annualRecurringRevenue,
    6_000_000 * 0.5
  )
})

// ──────────────────────────────────────────────────────── units and schedules

test('the same price in different units gives the same answer', () => {
  assert.equal(energyPricePerKwh(80, 'per_mwh'), 0.08)
  assert.equal(energyPricePerKwh(0.08, 'per_kwh'), 0.08)

  const perKwh = computeDealEconomics(
    deal({ lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.08 })] })
  )
  const perMwh = computeDealEconomics(
    deal({
      lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 80, priceUnit: 'per_mwh' })],
    })
  )
  assert.equal(perKwh.lines[0].annualRevenue, perMwh.lines[0].annualRevenue)
})

test('capacity prices convert between month, kW-year and MW-year', () => {
  assert.equal(capacityPricePerKwMonth(12, 'per_kw_month'), 12)
  assert.equal(capacityPricePerKwMonth(144, 'per_kw_year'), 12)
  assert.equal(capacityPricePerKwMonth(144_000, 'per_mw_year'), 12)
})

test('implied average MW applies no load factor', () => {
  // 8,760 MWh over a year is exactly 1 MW of average load.
  assert.equal(impliedAverageMw(8760), 1)
})

test('a ramp shorter than the term carries its last value, it does not go dark', () => {
  const ramp = [0.3, 0.7, 1]
  assert.equal(rampFactor(ramp, 1), 0.3)
  assert.equal(rampFactor(ramp, 3), 1)
  assert.equal(rampFactor(ramp, 15), 1, 'stabilized from year 3, not dark from year 4')
  assert.equal(rampFactor(null, 7), 1)
})

test('a lease-up ramp reduces the early years and not the stabilized figure', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('dc_lease', {
          itMw: 20,
          ratePerKwMonth: 150,
          occupancy: 1,
          pue: 1.3,
          termYears: 5,
          ramp: [0.25, 0.6, 1],
        }),
      ],
    })
  )
  const lease = result.lines[0]
  assert.equal(lease.annualRevenue, 36_000_000, 'stabilization is the peak of the ramp')
  assert.equal(lease.years[0].revenue, 9_000_000)
  assert.equal(lease.years[2].revenue, 36_000_000)
  assert.equal(lease.years[4].revenue, 36_000_000)
})

test('calendar years come from the start year', () => {
  const result = computeDealEconomics(
    deal({
      baseYear: 2027,
      lines: [line('capacity_charge', { mw: 10, price: 10, termYears: 3, startYear: 2029 })],
    })
  )
  assert.deepEqual(
    result.lines[0].years.map((y) => y.calendarYear),
    [2029, 2030, 2031]
  )
})

// ─────────────────────────────────────────────────────────────── the warnings

test('an energy price outside the sane band warns and does not block', () => {
  const low = computeDealEconomics(
    deal({ lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.005 })] })
  )
  assert.ok(low.warnings.some((w) => w.code === 'energy_price_band'))
  assert.equal(low.valid, true)

  const high = computeDealEconomics(
    deal({ lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.75 })] })
  )
  assert.ok(high.warnings.some((w) => w.code === 'energy_price_band'))

  const fine = computeDealEconomics(
    deal({ lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.08 })] })
  )
  assert.equal(fine.warnings.filter((w) => w.code === 'energy_price_band').length, 0)
})

test('a per kW-year lease rate in the monthly field is caught', () => {
  const result = computeDealEconomics(
    deal({ lines: [line('dc_lease', { itMw: 20, ratePerKwMonth: 1800, occupancy: 1, pue: 1.3 })] })
  )
  const warning = result.warnings.find((w) => w.code === 'dc_rate_unit')
  assert.ok(warning)
  assert.ok(warning.message.includes('per kW-year'), warning.message)
})

test('a benchmark older than a year wants refreshing, and an undated one says so', () => {
  const now = new Date('2026-10-05T00:00:00Z')
  const stale = computeDealEconomics(
    deal({
      lines: [
        line('dc_lease', {
          itMw: 10,
          ratePerKwMonth: 150,
          occupancy: 1,
          pue: 1.3,
          fields: {
            'the lease rate': {
              status: 'benchmark',
              source: 'Primary markets survey',
              sourceRef: null,
              asOf: '2024-01-15',
              note: null,
            },
          },
        }),
      ],
    }),
    { now }
  )
  const warning = stale.warnings.find((w) => w.code === 'stale_benchmark')
  assert.ok(warning)
  assert.ok(warning.message.includes('months old'), warning.message)

  const undated = computeDealEconomics(
    deal({
      lines: [
        line('dc_lease', {
          itMw: 10,
          ratePerKwMonth: 150,
          occupancy: 1,
          pue: 1.3,
          fields: {
            'the lease rate': {
              status: 'benchmark',
              source: 'A deck',
              sourceRef: null,
              asOf: null,
              note: null,
            },
          },
        }),
      ],
    }),
    { now }
  )
  assert.ok(undated.warnings.some((w) => w.code === 'undated_source'))
})

test('peak above firm is surfaced, because the allocations only add averages', () => {
  const b = bucket({ label: 'Anchor load', peakMw: 180 })
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 150 })],
      buckets: [b],
      lines: [line('energy_sale', { mw: 100, loadFactor: 0.6, price: 0.08, bucketId: b.id })],
    })
  )
  assert.ok(result.warnings.some((w) => w.code === 'peak_above_firm'))
  // Average load fits inside firm, so nothing blocks. The peak does not.
  assert.equal(result.valid, true)
})

test('a drawing line with no bucket puts its load in no total, and that blocks', () => {
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 150 })],
      buckets: [bucket()],
      lines: [line('capacity_charge', { label: 'Unbucketed', mw: 40, price: 10 })],
    })
  )
  assert.equal(result.valid, false)
  const orphan = result.errors.find((e) => e.code === 'orphaned_draw')
  assert.ok(orphan)
  assert.ok(orphan.message.includes('Unbucketed'), orphan.message)
})

test('power passed through and also kept as revenue is flagged as a double count', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('dc_lease', {
          itMw: 20,
          ratePerKwMonth: 150,
          occupancy: 1,
          pue: 1.3,
          powerPassedThrough: true,
          powerRevenueRetained: true,
        }),
      ],
    })
  )
  assert.ok(result.warnings.some((w) => w.code === 'power_double_counted'))
})

test('no firm capacity makes utilization and per-MW figures unavailable, and says so', () => {
  const result = computeDealEconomics(
    deal({ lines: [line('one_time_lump', { amount: 1_000_000 })] })
  )
  assert.equal(result.ledger.firmMw, null, 'null, not zero: nobody has said how big the plant is')
  assert.equal(result.ledger.utilizationPct, null)
  assert.equal(result.tiers.perMwGross.contractValue, null)
  assert.ok(result.warnings.some((w) => w.code === 'no_firm_capacity'))
})

test('availability derates firm capacity and null availability does not', () => {
  const derated = computeDealEconomics(
    deal({ sources: [source({ nameplateMw: 100, availabilityPct: 95 })] })
  )
  assert.equal(derated.ledger.firmMw, 95)

  const plain = computeDealEconomics(deal({ sources: [source({ nameplateMw: 100 })] }))
  assert.equal(plain.ledger.firmMw, 100, 'no availability claimed is not zero availability')
})

test('per-MW metrics divide by firm capacity', () => {
  const b = bucket()
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 200 })],
      buckets: [b],
      lines: [
        line('one_time_per_mw', { mw: 200, pricePerMw: 10_000_000 }),
      ],
    })
  )
  assert.equal(result.tiers.perMwGross.totalProjectValue, 10_000_000)
  assert.equal(result.tiers.perMwGross.oneTimeRevenue, 10_000_000)
})

test('weakestStatus returns null for an empty set rather than the strongest', () => {
  assert.equal(weakestStatus([]), null)
  assert.equal(weakestStatus([null, undefined]), null)
  assert.equal(weakestStatus(['validated', 'contracted']), 'contracted')
  assert.equal(weakestStatus(['contracted', 'benchmark', 'validated']), 'benchmark')
})

test('a model with no buckets is a scratchpad, not a violated ledger', () => {
  // The quick calc's minimum input: MW and one price. No ledger in play.
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 50 })],
      lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.08 })],
    })
  )
  assert.equal(result.valid, true, 'a back-of-envelope calc still answers')
  assert.equal(result.lines[0].annualRevenue, 6_307_200)
  assert.equal(result.ledger.allocatedMw, 10, 'the draw still counts against firm capacity')
  assert.equal(result.ledger.noBuckets, true)
  const warning = result.warnings.find((w) => w.code === 'no_allocation_ledger')
  assert.ok(warning, 'the absent ledger is named, not pretended to be violated')
  assert.ok(warning.message.includes('before treating it as a deal model'), warning.message)

  // But a model that HAS buckets enforces them: see the orphaned-draw test.
  const strict = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 50 })],
      buckets: [bucket({ label: 'Anchor load' })],
      lines: [line('energy_sale', { mw: 10, loadFactor: 0.9, price: 0.08 })],
    })
  )
  assert.equal(strict.valid, false, 'once a ledger exists, a line must name a bucket')
})
