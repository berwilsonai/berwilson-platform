/**
 * Does the deal economics engine get the arithmetic right on deals we know?
 *
 *   npm test                                    # the assertions
 *   node --no-deprecation --import ./deploy/register.mjs \
 *        scripts/verify-economics.mts           # this: the worked figures
 *
 * `npm test` proves the formulas against the brief's acceptance cases. This
 * script is the other half: it prints every derived figure for two real deal
 * SHAPES so the numbers can be judged by someone who knows the deals, before
 * anything is saved against a record. Read-only, touches no database, invents
 * no prices. Every figure below is a planning assumption chosen to exercise a
 * line type, not a quote.
 *
 * Follows the read-only dry-run convention of scripts/verify-unfiled-documents.mts:
 * print what the engine would conclude, so it can be argued with.
 */

import {
  computeDealEconomics,
  type CapacityBucket,
  type DealEconomicsInput,
  type DealEconomicsResult,
  type RevenueLine,
  type Spv,
} from '@/lib/economics'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const OFF = '\x1b[0m'

let failures = 0

function check(label: string, pass: boolean, detail: string): void {
  if (pass) {
    console.log(`  ${GREEN}✓${OFF} ${label} ${DIM}${detail}${OFF}`)
  } else {
    failures += 1
    console.log(`  ${RED}✗${OFF} ${label} ${RED}${detail}${OFF}`)
  }
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'not set'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function mw(n: number | null | undefined): string {
  return n == null ? 'not set' : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} MW`
}

function pct(n: number | null | undefined): string {
  return n == null ? 'not set' : `${n.toFixed(1)}%`
}

function heading(text: string): void {
  console.log(`\n${BOLD}${text}${OFF}`)
  console.log('─'.repeat(text.length))
}

/** Every field null, so a scenario below states only what it means to state. */
function mkLine<T extends RevenueLine['type']>(
  type: T,
  over: Partial<Extract<RevenueLine, { type: T }>> & { id: string; label: string }
): Extract<RevenueLine, { type: T }> {
  const base = {
    spvId: null,
    isBerWilsonRevenue: true,
    status: 'planning_assumption' as const,
    costs: { opexAnnual: null, fixedOmPerKwYear: null, variableOmPerMwh: null, fuel: null },
    notes: null,
    startYear: null,
    termYears: null,
    escalatorPct: null,
    ramp: null,
    schedule: null,
    countsTowardProjectValue: true,
    bucketId: null,
    mode: 'forward',
    priceUnit: type === 'energy_sale' ? 'per_kwh' : type === 'land' ? 'per_acre' : 'per_kw_month',
    disposition: 'sale',
    base: 'referenced_line_value',
    kind: 'other',
    transferable: false,
    powerPassedThrough: false,
    powerRevenueRetained: false,
    isCarveOut: type === 'fee_margin',
  }
  return { ...base, type, ...over } as unknown as Extract<RevenueLine, { type: T }>
}

function report(name: string, input: DealEconomicsInput): DealEconomicsResult {
  const r = computeDealEconomics(input)
  heading(name)

  console.log(`${CYAN}Capacity ledger${OFF}`)
  console.log(`  Nameplate ${mw(r.ledger.nameplateMw)}   Firm ${mw(r.ledger.firmMw)}`)
  for (const s of r.ledger.sources) {
    const basis =
      s.basis === 'block_design'
        ? `${s.blocksInService} of ${input.sources.find((x) => x.id === s.sourceId)?.blockCount} blocks in service`
        : s.basis
    console.log(`    ${s.label}: ${mw(s.firmMw)} firm  ${DIM}(${basis})${OFF}`)
  }
  console.log(
    `  Allocated ${mw(r.ledger.allocatedMw)}   Surplus ${mw(r.ledger.surplusMw)}   Utilization ${pct(r.ledger.utilizationPct)}`
  )
  for (const b of r.ledger.buckets) {
    if (b.allocatedMw === 0) continue
    console.log(
      `    ${b.label}: ${mw(b.allocatedMw)}  ${DIM}${b.lines.map((l) => l.lineLabel).join(', ')}${OFF}`
    )
  }

  console.log(`\n${CYAN}Revenue lines${OFF}`)
  for (const l of r.lines) {
    const headline =
      l.shape === 'recurring'
        ? `${money(l.annualRevenue)}/yr, ${money(l.contractValue)} over term`
        : `${money(l.oneTimeValue)} one-time`
    const ours = l.isBerWilsonRevenue || l.isCaptureLine ? '' : `${DIM} [partner revenue]${OFF}`
    console.log(`  ${l.label}: ${headline}${ours}`)
    if (l.facilityMw > 0) console.log(`      draws ${mw(l.facilityMw)}`)
    if (l.annualEnergyMwh != null) {
      console.log(`      ${l.annualEnergyMwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} MWh/yr`)
    }
    if (l.impliedAverageMw != null) console.log(`      implies ${mw(l.impliedAverageMw)} average load`)
  }

  console.log(`\n${CYAN}Deal size, every definition${OFF}`)
  const tiers: [string, typeof r.tiers.grossGenerated][] = [
    ['Gross generated (all parties)', r.tiers.grossGenerated],
    ['Ber Wilson gross', r.tiers.berWilsonGross],
    ['Ber Wilson net of SPV ownership', r.tiers.berWilsonNet],
  ]
  for (const [label, t] of tiers) {
    console.log(`  ${BOLD}${label}${OFF}`)
    console.log(`      Annual recurring   ${money(t.annualRecurringRevenue)}`)
    console.log(`      Contract value     ${money(t.contractValue)}`)
    console.log(`      One-time           ${money(t.oneTimeRevenue)}`)
    console.log(`      Tax credits        ${money(t.taxCredits)}`)
    console.log(`      Total project      ${money(t.totalProjectValue)}`)
    if (t.stabilizedAssetValue != null) {
      console.log(`      Asset value        ${money(t.stabilizedAssetValue)}`)
    }
  }
  if (r.tiers.undetermined.lineCount > 0) {
    console.log(
      `  ${YELLOW}Undetermined (ours, but the SPV split is not set)${OFF}  ${money(r.tiers.undetermined.annualRecurringRevenue)}/yr, ${money(r.tiers.undetermined.oneTimeRevenue)} one-time`
    )
  }
  if (r.tiers.capturePctOfGross != null) {
    console.log(`  Ber Wilson's share of all value on the deal: ${pct(r.tiers.capturePctOfGross)}`)
  }
  if (r.tiers.captureOneTimePctOfProjectValue != null) {
    console.log(
      `  One-time capture as a share of total project value: ${pct(r.tiers.captureOneTimePctOfProjectValue)}`
    )
  }
  if (r.tiers.perMwCapture.contractValue != null) {
    console.log(
      `  Per MW of firm capacity: capture ${money(r.tiers.perMwCapture.contractValue)} contract, gross ${money(r.tiers.perMwGross.contractValue)}`
    )
  }

  if (r.byEntity.length > 1) {
    console.log(`\n${CYAN}By vehicle${OFF}`)
    for (const e of r.byEntity) {
      const own = e.bwOwnershipPct == null ? `${YELLOW}no split set${OFF}` : `${e.bwOwnershipPct}% ours`
      console.log(
        `  ${e.label} ${DIM}(${own})${OFF}: ${money(e.gross.annualRecurringRevenue)}/yr, ${money(e.gross.oneTimeRevenue)} one-time`
      )
    }
  }

  console.log(`\n${CYAN}Confidence${OFF}`)
  console.log(`  Weakest input anywhere in the model: ${r.status ?? 'nothing entered'}`)
  console.log(`  Valid: ${r.valid ? `${GREEN}yes${OFF}` : `${RED}no${OFF}`}`)

  if (r.errors.length > 0) {
    console.log(`\n${RED}Blocking${OFF}`)
    for (const e of r.errors) console.log(`  ${RED}✗${OFF} ${e.message}`)
  }
  if (r.warnings.length > 0) {
    console.log(`\n${YELLOW}Warnings${OFF}`)
    for (const w of r.warnings) console.log(`  ${YELLOW}!${OFF} ${w.message}`)
  }
  if (r.missing.length > 0) {
    console.log(`\n${DIM}Still missing (${r.missing.length})${OFF}`)
    const seen = new Set<string>()
    for (const m of r.missing) {
      const key = `${m.lineLabel ?? 'deal'}|${m.what}`
      if (seen.has(key)) continue
      seen.add(key)
      console.log(`  ${DIM}- ${m.lineLabel ? `${m.lineLabel}: ` : ''}${m.what}${OFF}`)
    }
  }

  return r
}

// ───────────────────────────────────────── 1. Stockton, reconciled against itself

const stocktonBucket: CapacityBucket = {
  id: 'b1',
  label: 'Retail and anchor load',
  priority: 10,
  peakMw: null,
}

const stockton = report('Stockton Power Nexus, reverse mode against the stated $152.5M', {
  sources: [
    {
      id: 's1',
      label: 'Interconnect',
      kind: 'grid_interconnect',
      nameplateMw: 150,
      availabilityPct: null,
      blockCount: null,
      redundantBlocks: null,
      blockMw: null,
      statedNetMw: null,
      status: 'planning_assumption',
    },
  ],
  buckets: [stocktonBucket],
  spvs: [],
  discountRatePct: null,
  capRatePct: null,
  baseYear: null,
  statedTotal: { amount: 152_500_000, shape: 'recurring' },
  lines: (
    [
      ['Energy, tranche 1', 52_899_980, 0.14],
      ['Energy, tranche 2', 37_400_040, 0.09],
      ['Energy, tranche 3', 21_000_000, 0.14],
      ['Energy, tranche 4', 9_599_940, 0.14],
    ] as [string, number, number][]
  ).map(([label, targetAnnualRevenue, price], i) =>
    mkLine('energy_sale', {
      id: `e${i}`,
      label,
      mode: 'reverse',
      targetAnnualRevenue,
      price,
      priceUnit: 'per_kwh',
      bucketId: stocktonBucket.id,
    })
  ),
})

check(
  'implied average load totals about 115.5 MW',
  Math.abs(stockton.lines.reduce((s, l) => s + (l.impliedAverageMw ?? 0), 0) - 115.52) < 0.05,
  `${stockton.lines.reduce((s, l) => s + (l.impliedAverageMw ?? 0), 0).toFixed(2)} MW against 150 firm`
)
check(
  'utilization is about 77.0%',
  Math.abs((stockton.ledger.utilizationPct ?? 0) - 77.01) < 0.05,
  pct(stockton.ledger.utilizationPct)
)
check(
  'the unexplained remainder is named, not absorbed',
  stockton.warnings.some((w) => w.code === 'unattributed_total' && w.message.includes('31,600,040')),
  'about $31.6M belongs to lines nobody has priced'
)

// ─────────────────── 2. A resilient microgrid and data center campus, full stack

const land: Spv = {
  id: 'spv-land',
  label: 'Helper Land LLC',
  purpose: 'land',
  entityId: null,
  bwOwnershipPct: 100,
  status: 'planning_assumption',
}
const energy: Spv = {
  id: 'spv-energy',
  label: 'Helper Energy LLC',
  purpose: 'energy',
  entityId: null,
  bwOwnershipPct: 60,
  status: 'planning_assumption',
}
const dc: Spv = {
  id: 'spv-dc',
  label: 'Helper Data Center LLC',
  purpose: 'data_center',
  entityId: null,
  // Deliberately unset: the financing partners' share is not decided.
  bwOwnershipPct: null,
  status: 'planning_assumption',
}

const buckets: CapacityBucket[] = [
  { id: 'local', label: 'Local and retail load', priority: 10, peakMw: null },
  { id: 'critical', label: 'Anchor and critical load', priority: 30, peakMw: null },
  { id: 'dcload', label: 'Data center facility load', priority: 40, peakMw: null },
  { id: 'reserve', label: 'Reserve margin', priority: 60, peakMw: null },
]

const powerSale = mkLine('energy_sale', {
  id: 'l-power',
  label: 'Municipal power offtake',
  mw: 20,
  loadFactor: 0.65,
  price: 0.075,
  priceUnit: 'per_kwh',
  termYears: 20,
  escalatorPct: 2.5,
  bucketId: 'local',
  spvId: energy.id,
})

const internals = mkLine('one_time_per_mw', {
  id: 'l-internals',
  label: 'Data center internals (Elite Solutions / Avant)',
  mw: 100,
  pricePerMw: 17_500_000,
  // Built and earned by the partner. None of this $1.75B is ours.
  isBerWilsonRevenue: false,
  countsTowardProjectValue: true,
  spvId: dc.id,
})

const shell = mkLine('one_time_per_mw', {
  id: 'l-shell',
  label: 'Facility shell and sitework (Ber Wilson EPC)',
  mw: 130,
  pricePerMw: 4_200_000,
  costPerMw: 3_700_000,
  countsTowardProjectValue: true,
  spvId: dc.id,
})

const campus = report('Helper / Giovanni style resilient campus, every value layer at once', {
  sources: [
    {
      id: 'grid',
      label: 'Grid interconnect',
      kind: 'grid_interconnect',
      nameplateMw: 100,
      availabilityPct: null,
      blockCount: null,
      redundantBlocks: null,
      blockMw: null,
      statedNetMw: null,
      status: 'loi_term_sheet',
    },
    {
      id: 'cells',
      label: 'Fuel cell plant',
      kind: 'onsite_generation',
      nameplateMw: null,
      availabilityPct: null,
      blockCount: 6,
      redundantBlocks: 1,
      blockMw: 25,
      statedNetMw: 150,
      status: 'vendor_quoted',
    },
  ],
  buckets,
  spvs: [land, energy, dc],
  discountRatePct: 9,
  capRatePct: 6.3,
  baseYear: 2027,
  statedTotal: null,
  lines: [
    powerSale,
    mkLine('energy_attribute', {
      id: 'l-recs',
      label: 'Renewable energy credits',
      ridesOnLineId: powerSale.id,
      pricePerMwh: 11,
      attributeKind: 'REC',
      termYears: 20,
      spvId: energy.id,
    }),
    mkLine('capacity_charge', {
      id: 'l-resilience',
      label: 'Resilience capacity payment, hospital and medevac',
      mw: 15,
      price: 11,
      priceUnit: 'per_kw_month',
      termYears: 20,
      escalatorPct: 2,
      bucketId: 'critical',
      spvId: energy.id,
    }),
    mkLine('om_service', {
      id: 'l-om',
      label: 'Microgrid O&M agreement',
      mw: 125,
      price: 18,
      priceUnit: 'per_kw_year',
      termYears: 20,
      escalatorPct: 2.5,
      counterparty: 'Helper Energy LLC',
      spvId: energy.id,
    }),
    mkLine('dc_lease', {
      id: 'l-lease',
      label: 'Data center lease, turnkey',
      itMw: 100,
      ratePerKwMonth: 145,
      occupancy: 0.95,
      pue: 1.3,
      termYears: 15,
      escalatorPct: 3,
      ramp: [0.2, 0.55, 0.85, 1],
      bucketId: 'dcload',
      spvId: dc.id,
    }),
    internals,
    mkLine('recurring_fee_on_line', {
      id: 'l-commission',
      label: 'Internals commission, split 50/50 with Elite',
      referencedLineId: internals.id,
      base: 'referenced_line_value',
      annualRatePct: 1.5,
      ourSharePct: 50,
      partnerLabel: 'Elite Solutions / Avant',
      termYears: 15,
      isCarveOut: false,
      spvId: dc.id,
    }),
    shell,
    mkLine('one_time_per_unit', {
      id: 'l-steel',
      label: 'Prefab steel supply',
      quantity: 1_250_000,
      pricePerUnit: 33,
      costPerUnit: 20,
      unitLabel: 'square feet',
      countsTowardProjectValue: true,
    }),
    mkLine('one_time_per_unit', {
      id: 'l-homes',
      label: 'Workforce housing, homes sold',
      quantity: 120,
      pricePerUnit: 420_000,
      costPerUnit: 310_000,
      unitLabel: 'homes',
      countsTowardProjectValue: true,
      spvId: land.id,
    }),
    mkLine('land', {
      id: 'l-land',
      label: 'Powered land sale to the tenant',
      disposition: 'sale',
      mw: 0,
      acres: 180,
      price: 34_000,
      priceUnit: 'per_acre',
      countsTowardProjectValue: false,
      spvId: land.id,
    }),
    mkLine('tax_credit', {
      id: 'l-48e',
      label: 'Section 48E on the generation plant',
      amount: 94_000_000,
      kind: '48E',
      transferable: true,
      ourSharePct: 60,
      countsTowardProjectValue: false,
      spvId: energy.id,
    }),
    mkLine('fee_margin', {
      id: 'l-devfee',
      label: 'Development fee on the shell contract',
      referencedLineId: shell.id,
      pctOfLine: 4,
      isCarveOut: true,
    }),
  ],
})

check(
  'the fuel cell block design derates to 5 of 6 blocks',
  campus.ledger.sources[1].firmMw === 125,
  `${mw(campus.ledger.sources[1].firmMw)} firm from 6 blocks of 25 MW at N+1`
)
check(
  'the stated 150 MW net is flagged against the derived 125 MW',
  campus.warnings.some((w) => w.code === 'block_design_mismatch'),
  'the disagreement is kept, not settled silently'
)
check(
  'the data center lease draws facility load, not IT load',
  Math.abs((campus.lines.find((l) => l.lineId === 'l-lease')?.facilityMw ?? 0) - 130) < 1e-9,
  '100 MW IT at PUE 1.30 is 130 MW on the plant'
)
check(
  'the Elite commission is $13.1M a year to Ber Wilson',
  Math.abs((campus.lines.find((l) => l.lineId === 'l-commission')?.annualRevenue ?? 0) - 13_125_000) < 1,
  '1.5% of $1.75B, halved'
)
check(
  'the partner-built internals are revenue generated and not ours',
  campus.tiers.grossGenerated.totalProjectValue > campus.tiers.berWilsonGross.totalProjectValue,
  `${money(campus.tiers.grossGenerated.totalProjectValue)} at the project against ${money(campus.tiers.berWilsonGross.totalProjectValue)} through us`
)
check(
  'the data center SPV has no split, so its revenue is undetermined rather than ours',
  !campus.tiers.ownershipComplete && campus.tiers.undetermined.lineCount > 0,
  `${money(campus.tiers.undetermined.annualRecurringRevenue)}/yr held out of the net figure`
)
check(
  'the whole model reads as a planning number',
  campus.status === 'planning_assumption',
  'one planning assumption anywhere sets the confidence of every headline'
)

heading('Result')
if (failures === 0) {
  console.log(`${GREEN}All checks passed.${OFF} The figures above are the engine's, not a summary of them.`)
  console.log(
    `${DIM}Judge them against the real deals. Anything that looks wrong is a prompt to argue with a line type, not a rounding issue.${OFF}`
  )
} else {
  console.log(`${RED}${failures} check(s) failed.${OFF} Fix: npm test`)
  process.exitCode = 1
}
