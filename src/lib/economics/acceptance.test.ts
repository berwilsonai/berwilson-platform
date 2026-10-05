/**
 * The eleven acceptance tests from the build brief, verbatim in intent.
 *
 * Run: npm test
 *
 * Exact assertions where the brief states an exact figure. A relative tolerance
 * only where it says "about", and the tolerance is 0.1% rather than something
 * loose enough to pass a wrong formula.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeDealEconomics } from './compute'
import { fuelCostPerKwh } from './costs'
import { assetValue } from './costs'
import { bucket, closeTo, deal, line, source, spv } from './testing'

test('1. energy sale: 10 MW at 0.90 load factor and $0.08/kWh', () => {
  const b = bucket({ label: 'Anchor load' })
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 50 })],
      buckets: [b],
      lines: [
        line('energy_sale', {
          mw: 10,
          loadFactor: 0.9,
          price: 0.08,
          priceUnit: 'per_kwh',
          bucketId: b.id,
        }),
      ],
    })
  )

  const energy = result.lines[0]
  assert.equal(energy.annualEnergyMwh, 78_840, '78,840 MWh is 78,840,000 kWh')
  assert.equal((energy.annualEnergyMwh ?? 0) * 1000, 78_840_000)
  assert.equal(energy.annualRevenue, 6_307_200)
  assert.equal(result.valid, true)
})

test('2. reverse mode: the Stockton reconciliation', () => {
  const b = bucket({ label: 'Retail load' })
  const targets: [number, number][] = [
    [52_899_980, 0.14],
    [37_400_040, 0.09],
    [21_000_000, 0.14],
    [9_599_940, 0.14],
  ]
  const result = computeDealEconomics(
    deal({
      // 150 MW firm, which is what the 77% utilization is measured against.
      sources: [source({ label: 'Interconnect', nameplateMw: 150 })],
      buckets: [b],
      statedTotal: { amount: 152_500_000, shape: 'recurring' },
      lines: targets.map(([targetAnnualRevenue, price], i) =>
        line('energy_sale', {
          label: `Energy ${i + 1}`,
          mode: 'reverse',
          targetAnnualRevenue,
          price,
          priceUnit: 'per_kwh',
          bucketId: b.id,
        })
      ),
    })
  )

  const mwh = result.lines.map((l) => Math.round(l.annualEnergyMwh ?? 0))
  assert.deepEqual(mwh, [377_857, 415_556, 150_000, 68_571])

  const totalImpliedMw = result.lines.reduce((s, l) => s + (l.impliedAverageMw ?? 0), 0)
  assert.ok(closeTo(totalImpliedMw, 115.5, 0.001), `implied MW ${totalImpliedMw} is about 115.5`)

  assert.ok(
    closeTo(result.ledger.utilizationPct ?? 0, 77.0, 0.001),
    `utilization ${result.ledger.utilizationPct} is about 77.0%`
  )

  const energyRevenue = result.lines.reduce((s, l) => s + (l.annualRevenue ?? 0), 0)
  assert.equal(energyRevenue, 120_899_960)

  // The unexplained remainder is NAMED, not absorbed. $152.5M stated less
  // $120,899,960 of energy leaves about $31.6M belonging to other lines.
  const unattributed = result.warnings.find((w) => w.code === 'unattributed_total')
  assert.ok(unattributed, 'the remainder against the stated total is reported')
  assert.ok(
    unattributed.message.includes('31,600,040'),
    `message names the remainder: ${unattributed.message}`
  )
  // Every one of those four lines still lacks a term, so they are listed as
  // wanting a pricing basis rather than passing as complete.
  assert.ok(unattributed.message.includes('Energy 1'))
})

test('3. data center lease: 20 MW IT at $150/kW-month, PUE 1.30, 15 years at 3%', () => {
  const b = bucket({ label: 'Data center facility load' })
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 100 })],
      buckets: [b],
      lines: [
        line('dc_lease', {
          itMw: 20,
          ratePerKwMonth: 150,
          occupancy: 1,
          pue: 1.3,
          termYears: 15,
          escalatorPct: 3,
          bucketId: b.id,
        }),
      ],
    })
  )

  const lease = result.lines[0]
  assert.equal(lease.annualRevenue, 36_000_000)
  // The ledger holds FACILITY load, so the cooling load is in the total.
  assert.ok(closeTo(lease.facilityMw, 26, 1e-9), `facility draw ${lease.facilityMw} is 26 MW`)
  assert.equal(result.ledger.allocatedMw, 26)
  assert.ok(
    closeTo(lease.contractValue ?? 0, 669_600_000, 0.001),
    `contract value ${lease.contractValue} is about $669.6M`
  )
  assert.equal(result.valid, true)
})

test('4. ledger overage: 160 MW allocated against 150 MW firm is invalid', () => {
  const b = bucket()
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 150 })],
      buckets: [b],
      lines: [
        line('capacity_charge', { label: 'Block A', mw: 100, price: 10, bucketId: b.id }),
        line('capacity_charge', { label: 'Block B', mw: 60, price: 10, bucketId: b.id }),
      ],
    })
  )

  assert.equal(result.valid, false, 'an overage blocks')
  assert.equal(result.ledger.allocatedMw, 160)
  assert.equal(result.ledger.overageMw, 10, 'the overage is identified to the megawatt')
  const overage = result.errors.find((e) => e.code === 'ledger_overage')
  assert.ok(overage)
  assert.ok(overage.message.includes('10 MW more capacity'), overage.message)
  // Nothing was prorated: the allocation is reported as entered.
  assert.equal(result.ledger.surplusMw, -10)
})

test('4b. the same megawatts claimed by two revenue lines is rejected', () => {
  const b = bucket()
  const result = computeDealEconomics(
    deal({
      sources: [source({ nameplateMw: 150 })],
      buckets: [b],
      lines: [
        line('energy_sale', {
          label: 'Power sale',
          mw: 150,
          loadFactor: 1,
          price: 0.08,
          bucketId: b.id,
        }),
        line('capacity_charge', {
          label: 'Capacity payment on the same 150 MW',
          mw: 150,
          price: 10,
          bucketId: b.id,
        }),
      ],
    })
  )

  assert.equal(result.valid, false)
  assert.equal(result.ledger.allocatedMw, 300)
  assert.equal(result.ledger.overageMw, 150)
})

test('5. block redundancy: 24 blocks of 50 MW at N+4 is 1,000 MW firm', () => {
  const result = computeDealEconomics(
    deal({
      sources: [
        source({
          label: 'Fuel cell plant',
          kind: 'onsite_generation',
          blockCount: 24,
          redundantBlocks: 4,
          blockMw: 50,
          statedNetMw: 1104,
        }),
      ],
    })
  )

  assert.equal(result.ledger.firmMw, 1000)
  assert.equal(result.ledger.nameplateMw, 1200, 'nameplate counts the redundant blocks')
  assert.equal(result.ledger.sources[0].blocksInService, 20)
  assert.equal(result.ledger.sources[0].basis, 'block_design')

  const mismatch = result.warnings.find((w) => w.code === 'block_design_mismatch')
  assert.ok(mismatch, 'a stated net figure that disagrees is surfaced, not overwritten')
  assert.ok(mismatch.message.includes('1,104'), mismatch.message)
  assert.ok(mismatch.message.includes('1,000'), mismatch.message)
  // A disagreement is a warning: the derived figure is used and both are kept.
  assert.equal(result.valid, true)
})

test('6. milestones: $250M split 10/25/35/20/10, and 95% is invalid', () => {
  const ok = computeDealEconomics(
    deal({
      lines: [
        line('one_time_per_mw', {
          label: 'EPC',
          mw: 10,
          pricePerMw: 25_000_000,
          schedule: [
            { label: 'NTP', pct: 10, date: null, monthsFromNtp: 0 },
            { label: 'Design', pct: 25, date: null, monthsFromNtp: 3 },
            { label: 'Construction', pct: 35, date: null, monthsFromNtp: 9 },
            { label: 'Commissioning', pct: 20, date: null, monthsFromNtp: 15 },
            { label: 'Final', pct: 10, date: null, monthsFromNtp: 18 },
          ],
        }),
      ],
    })
  )

  const epc = ok.lines[0]
  assert.equal(epc.oneTimeValue, 250_000_000)
  assert.deepEqual(
    epc.schedule.map((s) => s.amount),
    [25_000_000, 62_500_000, 87_500_000, 50_000_000, 25_000_000]
  )
  assert.equal(ok.valid, true)

  const short = computeDealEconomics(
    deal({
      lines: [
        line('one_time_per_mw', {
          label: 'EPC',
          mw: 10,
          pricePerMw: 25_000_000,
          schedule: [
            { label: 'NTP', pct: 10, date: null, monthsFromNtp: 0 },
            { label: 'Rest', pct: 85, date: null, monthsFromNtp: 12 },
          ],
        }),
      ],
    })
  )
  assert.equal(short.valid, false, 'a schedule that does not total 100% blocks')
  const bad = short.errors.find((e) => e.code === 'invalid_schedule')
  assert.ok(bad)
  assert.ok(bad.message.includes('95%'), bad.message)
})

test('7. fuel cost: 6,500 Btu/kWh at $3.50/MMBtu is $0.02275/kWh', () => {
  const perKwh = fuelCostPerKwh({ heatRate: 6500, gasPricePerMmbtu: 3.5 })
  assert.equal(perKwh, 0.02275)
})

test('8. asset value: $30M NOI at a 6.3% cap rate is about $476.2M', () => {
  const value = assetValue(30_000_000, 6.3)
  assert.ok(value != null)
  assert.ok(closeTo(value, 476_200_000, 0.001), `${value} is about $476.2M`)
})

test('9. capture: a $150M EPC line with a 12% margin yields $18M, and the rollup shows $18M', () => {
  const epc = line('one_time_lump', {
    label: 'EPC contract',
    amount: 150_000_000,
    // The build contract is revenue at the project and not ours. This flag is
    // the whole difference between a $150M deal and an $18M one.
    isBerWilsonRevenue: false,
    countsTowardProjectValue: true,
  })
  const result = computeDealEconomics(
    deal({
      lines: [
        epc,
        line('fee_margin', {
          label: 'EPC margin',
          referencedLineId: epc.id,
          pctOfLine: 12,
          isCarveOut: true,
        }),
      ],
    })
  )

  const fee = result.lines[1]
  assert.equal(fee.oneTimeValue, 18_000_000)
  assert.equal(result.tiers.berWilsonGross.oneTimeRevenue, 18_000_000, 'capture is $18M')
  // ⚠ And the pipeline rolls up $18M, not $150M. The gross stays visible beside
  // it, and the carve-out is NOT added to it: $150M, never $168M.
  assert.equal(result.tiers.grossGenerated.oneTimeRevenue, 150_000_000)
  assert.equal(result.tiers.grossGenerated.totalProjectValue, 150_000_000)
  assert.ok(
    closeTo(result.tiers.captureOneTimePctOfProjectValue ?? 0, 12, 1e-9),
    'capture is 12% of total project value'
  )
  // Like for like, our $18M against the $150M of value on the deal: also 12%.
  assert.ok(closeTo(result.tiers.capturePctOfGross ?? 0, 12, 1e-9))
  assert.equal(result.valid, true)
})

test('10. provenance: one planning assumption beside three contracted inputs reads as planning', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('energy_sale', {
          mw: 10,
          loadFactor: 0.9,
          price: 0.08,
          termYears: 20,
          escalatorPct: 2,
          status: 'contracted',
          fields: {
            price: { status: 'contracted', source: 'PPA', sourceRef: null, asOf: null, note: null },
            term: { status: 'contracted', source: 'PPA', sourceRef: null, asOf: null, note: null },
            escalator: {
              status: 'contracted',
              source: 'PPA',
              sourceRef: null,
              asOf: null,
              note: null,
            },
            load_factor: {
              status: 'planning_assumption',
              source: 'No load study yet',
              sourceRef: null,
              asOf: null,
              note: 'Load study not done',
            },
          },
        }),
      ],
    })
  )

  assert.equal(result.lines[0].status, 'planning_assumption')
  assert.equal(result.status, 'planning_assumption', 'the deal inherits the weakest input')
  assert.equal(result.tiers.status, 'planning_assumption')
})

test('11. margin warning: $20M/MW revenue against $20M/MW cost earns nothing', () => {
  const result = computeDealEconomics(
    deal({
      lines: [
        line('one_time_per_mw', {
          label: 'Modular deployment',
          mw: 50,
          pricePerMw: 20_000_000,
          costPerMw: 20_000_000,
        }),
      ],
    })
  )

  const zero = result.warnings.find((w) => w.code === 'zero_margin')
  assert.ok(zero, 'a line that earns nothing says so')
  assert.ok(zero.message.includes('earns nothing'), zero.message)
  // A warning, not a refusal: pricing at cost is a decision someone may make.
  assert.equal(result.valid, true)
})

test('bonus: the Elite Solutions / Avant commission, end to end', () => {
  const dcSpv = spv({ label: 'Data Center SPV', purpose: 'data_center', bwOwnershipPct: 100 })
  // $3B to $4B per 200MW is about $17.5M/MW at the midpoint.
  const internals = line('one_time_per_mw', {
    label: 'Data center internals (Elite Solutions / Avant)',
    mw: 200,
    pricePerMw: 17_500_000,
    isBerWilsonRevenue: false,
    countsTowardProjectValue: true,
    spvId: dcSpv.id,
  })
  const result = computeDealEconomics(
    deal({
      spvs: [dcSpv],
      lines: [
        internals,
        line('recurring_fee_on_line', {
          label: 'Internals commission, split with Elite',
          referencedLineId: internals.id,
          base: 'referenced_line_value',
          annualRatePct: 1.5,
          ourSharePct: 50,
          partnerLabel: 'Elite Solutions / Avant',
          termYears: 10,
          // A commission the owner pays is money on top of the package, not a
          // slice of it, so it belongs in the gross as well as in capture.
          isCarveOut: false,
          spvId: dcSpv.id,
        }),
      ],
    })
  )

  assert.equal(internals.mw! * internals.pricePerMw!, 3_500_000_000)
  const fee = result.lines[1]
  // 1.5% of $3.5B is $52.5M a year; our half is $26.25M.
  assert.equal(fee.annualRevenue, 26_250_000)
  assert.equal(result.tiers.berWilsonGross.annualRecurringRevenue, 26_250_000)
  // The $3.5B package is revenue generated at the project and none of it is ours.
  assert.equal(result.tiers.grossGenerated.totalProjectValue, 3_500_000_000)
  assert.equal(result.tiers.berWilsonGross.oneTimeRevenue, null)
  assert.equal(result.valid, true)
})
