/**
 * Part D4-D8 — operating economics, GPUaaS revenue, and returns.
 *
 * ⚠ NOTHING IN HERE IS A FORECAST AND NOTHING IN HERE MAY BE PRESENTED AS ONE.
 * Part E of the brief is explicit: MOIC and IRR are TensorIQ's MODELLED case
 * and must always be shown beside a haircut case. `computeReturns` therefore
 * refuses to return a single number — it returns a scenario SET, and the base
 * case is labelled as TensorIQ's own, not ours.
 *
 * ⚠ AND THE REASON IS ARITHMETIC, NOT CAUTION. Equity is under 4% of total
 * capex in the reference model ($149.4M on $3.97B), so the whole return rests
 * on the contract rate holding. A 17% rate cut takes MOIC from about 15x to
 * about 2.6x; a 33% cut loses money. `rateSensitivity` exists to make that
 * visible rather than discoverable.
 *
 * Pure arithmetic, sibling imports only. Safe for a verification script.
 */

import { HOURS_PER_YEAR } from './sizing'

// ── D4: operating economics defaults, all TensorIQ's. ───────────────────────

/** Blended power cost. See `powerRateInconsistency` — the stated blend does not hold. */
export const DEFAULT_POWER_RATE_PER_KWH = 0.09
export const GRID_RATE_PER_KWH = 0.09
export const BEHIND_METER_RATE_PER_KWH = 0.18
export const GRID_SHARE = 0.8

/** Opex per utility MW-year: $0.75M fixed plus $0.25M variable. */
export const OPEX_FIXED_PER_UTILITY_MW = 750_000
export const OPEX_VARIABLE_PER_UTILITY_MW = 250_000
export const OPEX_ESCALATION_PCT = 2.5

/** Yield on cost the lessor strikes the facility lease at. */
export const YIELD_ON_COST_PCT = 18
export const LEASE_ESCALATION_PCT = 2.5
export const LEASE_TENOR_YEARS = 15

/** Contract rate and tenor. */
export const DEFAULT_CONTRACT_RATE_PER_GPU_HOUR = 6.43
export const CONTRACT_TERM_MONTHS = 60
export const RENEWAL_VOLUME_RETAINED = 0.8
export const PREPAYMENT_SHARE_OF_5YR_VALUE = 0.25
export const EXPECTED_SLA_CREDIT_PCT = 2.12

/** Asset-backed loan on the hardware. */
export const ABL_LTV = 0.7
export const ABL_RATE = 0.1
export const ABL_TERM_YEARS = 4

export const TAX_RATE = 0.15
export const DEPRECIATION_YEARS = 5
export const COMMUNITY_BENEFIT_PCT = 2
export const IT_SUSTAINING_RESERVE_PER_MW_YEAR = 1_500_000
export const DSCR_COVENANT = 1.3
export const DEFAULT_EXIT_MULTIPLE = 8
export const INVESTOR_STAKE = 0.25

/**
 * TensorIQ's own published return figures for the 74 MW reference case.
 *
 * ⚠ CARRIED SO OUR RECONSTRUCTION CAN BE COMPARED AGAINST THEIRS, NOT SO IT
 * CAN BE REPRODUCED. We can reproduce their sizing, their facility cost and
 * their whole annual expense stack to within a fraction of a percent (see
 * `sizing.test.ts` and the expense-stack test). We CANNOT reproduce these two
 * numbers, because the equity figure depends on model internals we were never
 * sent: the drawdown timing of a ~$1.9B customer prepayment, the tax and
 * depreciation schedule, the community-benefit charge and the IT sustaining
 * reserve. An equity base of $149.4M against $3.97B of capex is under 4%, and
 * at that leverage small changes in those internals move MOIC by multiples.
 *
 * So `computeScenario` reports its own arithmetic and FLAGS the divergence.
 * A reconstruction presented as their figure would be the worst of both.
 */
export const TENSORIQ_PUBLISHED = {
  equityRequired: 149_400_000,
  totalCapex: 3_970_000_000,
  stabilizedEbitda: 1_130_000_000,
  moic: 14.9,
  irrPct: 72,
} as const

/**
 * The capital recovery factor: the level payment per dollar drawn.
 *
 * CRF = r(1+r)^n / ((1+r)^n - 1). At 10% over 4 years this is 0.31547, which is
 * the 0.3155 the model uses.
 */
export function capitalRecoveryFactor(rate: number, years: number): number {
  if (rate === 0) return 1 / years
  const g = Math.pow(1 + rate, years)
  return (rate * g) / (g - 1)
}

/**
 * ⚠ THE STATED POWER BLEND DOES NOT PRODUCE THE STATED RATE. The model says
 * 80% grid at $0.09 and 20% behind-the-meter at $0.18, which blends to $0.108,
 * then uses $0.09 as the blended rate. That is a 20% understatement of a cost
 * line worth $58.4M a year on the 74 MW case — about $11.7M a year.
 */
export function powerRateInconsistency(): {
  statedBlended: number
  impliedByComponents: number
  understatementPct: number
} {
  const implied =
    GRID_SHARE * GRID_RATE_PER_KWH + (1 - GRID_SHARE) * BEHIND_METER_RATE_PER_KWH
  return {
    statedBlended: DEFAULT_POWER_RATE_PER_KWH,
    impliedByComponents: implied,
    understatementPct:
      ((implied - DEFAULT_POWER_RATE_PER_KWH) / implied) * 100,
  }
}

export interface OperatingInput {
  utilityMw: number
  gpuCount: number
  hardwareCost: number
  facilityCost: number
  /** $/GPU-hour, struck on AVAILABLE hours. Defaults to the model's $6.43. */
  contractRatePerGpuHour?: number | null
  powerRatePerKwh?: number | null
  yieldOnCostPct?: number | null
  /** Annual residual-value swap premium charged to the operating company. */
  residualSwapPremium?: number | null
  /** Annual software licence cost. */
  softwareLicences?: number | null
}

export interface OperatingYear {
  year: number
  revenue: number
  facilityLease: number
  power: number
  opex: number
  residualSwapPremium: number
  softwareLicences: number
  ebitda: number
  interest: number
  principal: number
  debtService: number
  dscr: number | null
}

export interface OperatingResult {
  availableGpuHoursPerYear: number
  annualRevenue: number
  revenuePerUtilityMwYear: number
  annualPower: number
  annualOpex: number
  annualFacilityLease: number
  annualRackRent: number
  stabilizedEbitda: number
  loanDraw: number
  annualDebtService: number
  dscrYearOne: number | null
  years: OperatingYear[]
  /** hardware + term x (rack rent + opex). Assumes a LEASED facility. */
  tcoSevenYear: number
  caveats: string[]
}

/**
 * The operating company's annual economics.
 *
 * Revenue is struck on AVAILABLE GPU-hours at 100% take-or-pay, which is the
 * model's own basis. Power is computed 24/7 on full utility load.
 */
export function computeOperating(input: OperatingInput): OperatingResult {
  const rate = input.contractRatePerGpuHour ?? DEFAULT_CONTRACT_RATE_PER_GPU_HOUR
  const powerRate = input.powerRatePerKwh ?? DEFAULT_POWER_RATE_PER_KWH
  const yieldOnCost = (input.yieldOnCostPct ?? YIELD_ON_COST_PCT) / 100
  const swapPremium = input.residualSwapPremium ?? 0
  const software = input.softwareLicences ?? 0

  const availableGpuHoursPerYear = input.gpuCount * HOURS_PER_YEAR
  const annualRevenue = availableGpuHoursPerYear * rate
  const annualPower = input.utilityMw * HOURS_PER_YEAR * 1000 * powerRate
  const annualOpex =
    input.utilityMw * (OPEX_FIXED_PER_UTILITY_MW + OPEX_VARIABLE_PER_UTILITY_MW)
  const annualFacilityLease = input.facilityCost * yieldOnCost

  const loanDraw = input.hardwareCost * ABL_LTV
  const annualDebtService = loanDraw * capitalRecoveryFactor(ABL_RATE, ABL_TERM_YEARS)

  const years: OperatingYear[] = []
  let balance = loanDraw
  for (let y = 1; y <= 7; y++) {
    const escalator = Math.pow(1 + OPEX_ESCALATION_PCT / 100, y - 1)
    const lease = annualFacilityLease * Math.pow(1 + LEASE_ESCALATION_PCT / 100, y - 1)
    const opex = annualOpex * escalator
    const ebitda = annualRevenue - lease - annualPower - opex - swapPremium - software
    const interest = y <= ABL_TERM_YEARS ? balance * ABL_RATE : 0
    const principal = y <= ABL_TERM_YEARS ? annualDebtService - interest : 0
    balance = Math.max(0, balance - principal)
    const debtService = interest + principal
    years.push({
      year: y,
      revenue: annualRevenue,
      facilityLease: lease,
      power: annualPower,
      opex,
      residualSwapPremium: swapPremium,
      softwareLicences: software,
      ebitda,
      interest,
      principal,
      debtService,
      dscr: debtService > 0 ? ebitda / debtService : null,
    })
  }

  const annualRackRent = annualFacilityLease + annualPower
  const caveats: string[] = [
    'Revenue is struck on AVAILABLE GPU-hours at 100% take-or-pay — the model’s own basis. Any utilisation below 100% does not reduce it, which is what take-or-pay means and also what makes the figure fragile if the contract is ever renegotiated.',
  ]

  const blend = powerRateInconsistency()
  if (powerRate === DEFAULT_POWER_RATE_PER_KWH) {
    caveats.push(
      `Power is at the stated $${DEFAULT_POWER_RATE_PER_KWH.toFixed(3)}/kWh blended rate, but the stated mix of ${GRID_SHARE * 100}% grid at $${GRID_RATE_PER_KWH} and ${(1 - GRID_SHARE) * 100}% behind-the-meter at $${BEHIND_METER_RATE_PER_KWH} blends to $${blend.impliedByComponents.toFixed(3)}/kWh. The stated rate understates the cost by ${blend.understatementPct.toFixed(1)}%.`
    )
  }
  caveats.push(
    `The facility lease runs ${LEASE_TENOR_YEARS} years against a ${CONTRACT_TERM_MONTHS / 12}-year contract term, leaving ${LEASE_TENOR_YEARS - CONTRACT_TERM_MONTHS / 12} years of lease with no contracted revenue behind it.`
  )

  return {
    availableGpuHoursPerYear,
    annualRevenue,
    revenuePerUtilityMwYear:
      input.utilityMw > 0 ? annualRevenue / input.utilityMw : 0,
    annualPower,
    annualOpex,
    annualFacilityLease,
    annualRackRent,
    stabilizedEbitda: years[0]?.ebitda ?? 0,
    loanDraw,
    annualDebtService,
    dscrYearOne: years[0]?.dscr ?? null,
    years,
    // ⚠ TCO assumes a LEASED facility, so facility capex must never be added on
    // top of it. Doing so double counts the building.
    tcoSevenYear: input.hardwareCost + 7 * (annualRackRent + annualOpex),
    caveats,
  }
}

// ── D6: returns, always as a scenario set. ──────────────────────────────────

export interface ScenarioAssumptions {
  label: string
  /** Multiplier on the contract rate. 1.0 is TensorIQ's case. */
  rateFactor: number
  exitMultiple: number
  /** Share of the original rate achieved on re-contracting after the term. */
  recontractFactor: number
  /** Whether platform and software resale revenue is included. Default false. */
  includePlatformRevenue: boolean
  note: string
}

/**
 * The scenario ladder.
 *
 * ⚠ THE PLATFORM AND SOFTWARE TAB IS EXCLUDED FROM EVERY CASE INCLUDING THE
 * BASE. Its own warning says the signed agreement bars resale and hosting, and
 * the reseller agreement it relies on does not exist. Revenue that is
 * contractually barred is not a haircut, it is zero.
 */
export const SCENARIOS: readonly ScenarioAssumptions[] = [
  {
    label: "TensorIQ modelled case",
    rateFactor: 1.0,
    exitMultiple: DEFAULT_EXIT_MULTIPLE,
    recontractFactor: RENEWAL_VOLUME_RETAINED,
    includePlatformRevenue: false,
    note: "TensorIQ's own assumptions. A modelled case, not a forecast.",
  },
  {
    label: 'Haircut — rate down 15%',
    rateFactor: 0.85,
    exitMultiple: 6,
    recontractFactor: 0.7,
    includePlatformRevenue: false,
    note: 'Lower rate, 6x exit, re-contracting at 70% of rate.',
  },
  {
    label: 'Haircut — rate down 30%',
    rateFactor: 0.7,
    exitMultiple: 5,
    recontractFactor: 0.6,
    includePlatformRevenue: false,
    note: 'Lower rate, 5x exit, re-contracting at 60% of rate, lower GPU residual.',
  },
]

export interface ReturnsResult {
  label: string
  note: string
  contractRate: number
  stabilizedEbitda: number
  dscrYearOne: number | null
  equityInvested: number
  equityValueAtExit: number
  investorShareOfExit: number
  moic: number | null
  irrPct: number | null
  meetsCovenant: boolean
  caveats: string[]
}

/**
 * Equity value at exit = 8 x three-year forward average EBITDA, less the loan
 * balance, plus cash, less undrawn deferred revenue.
 */
export function computeScenario(
  input: OperatingInput,
  scenario: ScenarioAssumptions,
  options: { equityInvested?: number | null; cash?: number; undrawnDeferredRevenue?: number } = {}
): ReturnsResult {
  const baseRate = input.contractRatePerGpuHour ?? DEFAULT_CONTRACT_RATE_PER_GPU_HOUR
  const rate = baseRate * scenario.rateFactor
  const op = computeOperating({ ...input, contractRatePerGpuHour: rate })

  // Three-year forward average EBITDA, with re-contracting applied after the
  // 60-month initial term.
  const termYears = CONTRACT_TERM_MONTHS / 12
  const forward = op.years.slice(0, 3).map((y) => {
    if (y.year <= termYears) return y.ebitda
    const recontracted = op.annualRevenue * scenario.recontractFactor
    return recontracted - y.facilityLease - y.power - y.opex - y.residualSwapPremium - y.softwareLicences
  })
  const avgEbitda = forward.reduce((s, v) => s + v, 0) / forward.length

  const loanBalanceAtExit =
    op.years.find((y) => y.year === 3)?.interest != null
      ? Math.max(
          0,
          op.loanDraw -
            op.years.filter((y) => y.year <= 3).reduce((s, y) => s + y.principal, 0)
        )
      : op.loanDraw

  const equityValueAtExit =
    scenario.exitMultiple * avgEbitda -
    loanBalanceAtExit +
    (options.cash ?? 0) -
    (options.undrawnDeferredRevenue ?? 0)

  // Equity required is total capex less the debt draw, unless stated.
  const equityInvested =
    options.equityInvested ?? Math.max(0, input.hardwareCost - op.loanDraw)

  const investorShare = equityValueAtExit * INVESTOR_STAKE
  const investorInvested = equityInvested * INVESTOR_STAKE
  const moic = investorInvested > 0 ? investorShare / investorInvested : null
  // Time-weighted over the 3-year hold.
  const irrPct =
    moic != null && moic > 0 ? (Math.pow(moic, 1 / 3) - 1) * 100 : moic != null ? -100 : null

  const caveats = [...op.caveats]
  caveats.push(
    `MOIC and IRR here are this platform's reconstruction, not TensorIQ's figure. TensorIQ publishes ${TENSORIQ_PUBLISHED.moic}x / ${TENSORIQ_PUBLISHED.irrPct}% on an equity base of $${(TENSORIQ_PUBLISHED.equityRequired / 1_000_000).toFixed(1)}M; the equity base used here is $${(equityInvested / 1_000_000).toFixed(1)}M. The gap is the prepayment drawdown, tax, depreciation and reserve treatment we were not sent. Read the DIRECTION and the sensitivity, never the multiple.`
  )
  if (op.dscrYearOne != null && Math.abs(op.dscrYearOne - DSCR_COVENANT) < 0.05) {
    caveats.push(
      `Year-one DSCR is ${op.dscrYearOne.toFixed(2)}x, sitting on the ${DSCR_COVENANT}x lender covenant floor. Revenue set at exactly the covenant minimum is a modelling artefact, not a margin.`
    )
  }

  return {
    label: scenario.label,
    note: scenario.note,
    contractRate: rate,
    stabilizedEbitda: op.stabilizedEbitda,
    dscrYearOne: op.dscrYearOne,
    equityInvested,
    equityValueAtExit,
    investorShareOfExit: investorShare,
    moic,
    irrPct,
    meetsCovenant: (op.dscrYearOne ?? 0) >= DSCR_COVENANT,
    caveats,
  }
}

/** Every scenario, so no single number can be quoted as the answer. */
export function computeReturns(
  input: OperatingInput,
  options: { equityInvested?: number | null } = {}
): ReturnsResult[] {
  return SCENARIOS.map((s) => computeScenario(input, s, options))
}

/**
 * MOIC across a range of rate cuts — the single most important output here.
 *
 * Equity is a very small share of capex, so the return is almost pure leverage
 * on the contract rate. This prints the cliff rather than describing it.
 */
export function rateSensitivity(
  input: OperatingInput,
  cuts: readonly number[] = [0, 0.1, 0.17, 0.25, 0.33, 0.4],
  options: { equityInvested?: number | null } = {}
): { cutPct: number; rate: number; moic: number | null; ebitda: number }[] {
  return cuts.map((cut) => {
    const r = computeScenario(
      input,
      {
        label: `rate -${(cut * 100).toFixed(0)}%`,
        rateFactor: 1 - cut,
        exitMultiple: DEFAULT_EXIT_MULTIPLE,
        recontractFactor: RENEWAL_VOLUME_RETAINED,
        includePlatformRevenue: false,
        note: '',
      },
      options
    )
    return { cutPct: cut * 100, rate: r.contractRate, moic: r.moic, ebitda: r.stabilizedEbitda }
  })
}

// ── D8: the residual value swap, a European put under Black-Scholes. ────────

/** Standard normal CDF, via the Abramowitz-Stegun erf approximation. */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const nd = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
  const cdf = 1 - nd * poly
  return x >= 0 ? cdf : 1 - cdf
}

export const RESIDUAL_VOLATILITY = 0.65
export const RESIDUAL_RISK_FREE = 0.036
export const RESIDUAL_DECAY_PER_YEAR = 0.19
export const GPU_LEASE_TENOR_YEARS = 5

export interface ResidualSwapInput {
  /** Spot: hardware cost. */
  hardwareCost: number
  /** Strike: the lease make-whole. */
  strike: number
  tenorYears?: number
  volatility?: number
  riskFree?: number
  decayPerYear?: number
}

export interface ResidualSwapResult {
  forwardReference: number
  putValue: number
  annualPremium: number
}

/** A European put on the GPU residual, priced on a decayed forward. */
export function priceResidualSwap(input: ResidualSwapInput): ResidualSwapResult {
  const T = input.tenorYears ?? GPU_LEASE_TENOR_YEARS
  const vol = input.volatility ?? RESIDUAL_VOLATILITY
  const r = input.riskFree ?? RESIDUAL_RISK_FREE
  const decay = input.decayPerYear ?? RESIDUAL_DECAY_PER_YEAR
  const K = input.strike

  const forward = input.hardwareCost * Math.exp(-decay * T)
  if (forward <= 0 || K <= 0 || T <= 0 || vol <= 0) {
    return { forwardReference: forward, putValue: 0, annualPremium: 0 }
  }
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(forward / K) + (vol * vol) / 2 * T) / (vol * sqrtT)
  const d2 = d1 - vol * sqrtT
  const discount = Math.exp(-r * T)
  const putValue = discount * (K * normCdf(-d2) - forward * normCdf(-d1))
  return { forwardReference: forward, putValue, annualPremium: putValue / T }
}

// ── D7: the real estate company. ────────────────────────────────────────────

export const RE_PROPERTY_PER_MW = 1_000_000
export const RE_CONSTRUCTION_PER_UTILITY_MW = 8_990_000
export const RE_FACILITY_EXPENSE_PCT = 2
export const RE_CAP_RATE_PCT = 8
export const RE_CONSTRUCTION_LOAN_LTC = 0.65
export const RE_CONSTRUCTION_RATE = 0.09
export const RE_PERM_LOAN_LTV = 0.65
export const RE_PERM_RATE = 0.07
export const RE_PERM_AMORT_YEARS = 25
export const RE_PERM_DSCR = 1.25

export interface RealEstateResult {
  propertyCost: number
  improvementsCost: number
  totalCost: number
  costPerUtilityMw: number
  leaseRevenue: number
  facilityExpense: number
  noi: number
  value: number
  constructionLoan: number
  permLoanByValue: number
  permLoanByDscr: number
  permLoan: number
  /** Total cost less the construction loan. The denominator for the levered multiple. */
  constructionEquity: number
  /** Permanent loan less total cost. Positive means the refinance returns all equity. */
  cashOutAtRefinance: number
  unleveredMoic: number | null
  leveredMoic: number | null
  caveats: string[]
}

/** The RE DevCo: owns the land, building and power agreement; leases to the OpCo. */
export function computeRealEstate(
  utilityMw: number,
  improvementsCost: number,
  options: { propertyPerMw?: number | null; yieldOnCostPct?: number | null } = {}
): RealEstateResult {
  const propertyCost = utilityMw * (options.propertyPerMw ?? RE_PROPERTY_PER_MW)
  const totalCost = propertyCost + improvementsCost
  // ⚠ THE LEASE IS STRUCK ON THE WHOLE DEVELOPED ASSET, LAND INCLUDED, NOT ON
  // IMPROVEMENTS NET OF LAND. The brief's wording ("lease revenue =
  // improvements x 18%") is ambiguous, and the two readings are 9% apart:
  // improvements-only gives NOI of $113.7M against the published $125M, while
  // total cost gives $125.5M and a $1.569B value — matching both published
  // figures. So "improvements" there means the developed asset as a whole.
  const leaseBase = totalCost
  const leaseRevenue = leaseBase * ((options.yieldOnCostPct ?? YIELD_ON_COST_PCT) / 100)
  const facilityExpense = leaseBase * (RE_FACILITY_EXPENSE_PCT / 100)
  const noi = leaseRevenue - facilityExpense
  const value = noi / (RE_CAP_RATE_PCT / 100)

  const constructionLoan = totalCost * RE_CONSTRUCTION_LOAN_LTC
  const permLoanByValue = value * RE_PERM_LOAN_LTV
  const annualDebtCapacity = noi / RE_PERM_DSCR
  const crf = capitalRecoveryFactor(RE_PERM_RATE, RE_PERM_AMORT_YEARS)
  const permLoanByDscr = crf > 0 ? annualDebtCapacity / crf : 0
  const permLoan = Math.min(permLoanByValue, permLoanByDscr)

  // ⚠ EQUITY IS MEASURED AT THE CONSTRUCTION LOAN, NOT AT THE PERMANENT LOAN.
  // At an 8% cap rate this asset is worth $1.57B against $784M of cost, so a
  // 65% LTV permanent loan of $1.02B EXCEEDS total cost — the refinance returns
  // more than was ever invested and permanent-loan equity is zero, which makes
  // a levered multiple undefined rather than large. Construction-period equity
  // is the defensible denominator and is what is used here.
  const constructionEquity = Math.max(0, totalCost - constructionLoan)
  const cashOutAtRefinance = permLoan - totalCost

  return {
    propertyCost,
    improvementsCost,
    totalCost,
    costPerUtilityMw: utilityMw > 0 ? totalCost / utilityMw : 0,
    leaseRevenue,
    facilityExpense,
    noi,
    value,
    constructionLoan,
    permLoanByValue,
    permLoanByDscr,
    permLoan,
    constructionEquity,
    cashOutAtRefinance,
    unleveredMoic: totalCost > 0 ? value / totalCost : null,
    leveredMoic:
      constructionEquity > 0 ? (value - permLoan) / constructionEquity : null,
    caveats: [
      `Land is in the RE DevCo's cost at $${(options.propertyPerMw ?? RE_PROPERTY_PER_MW) / 1_000_000}M per MW, but the land PURCHASE PRICE is excluded from Total Project Cost under Section 8.6 — so this figure is not a Schedule 1 fee base.`,
      `Value is NOI capitalised at ${RE_CAP_RATE_PCT}%, which is an assumption about an exit market, not a contracted number.`,
      ...(permLoan > totalCost
        ? [
            `The ${RE_PERM_LOAN_LTV * 100}% permanent loan of $${(permLoan / 1_000_000).toFixed(0)}M exceeds total cost of $${(totalCost / 1_000_000).toFixed(0)}M, so the refinance returns every dollar of equity and $${(cashOutAtRefinance / 1_000_000).toFixed(0)}M besides. That result rests entirely on the ${RE_CAP_RATE_PCT}% cap rate holding; it is the assumption doing the work, not the development.`,
          ]
        : []),
      `The levered multiple here is computed on construction-period equity and is this platform's reconstruction. It is not TensorIQ's published 5.0x.`,
      ...(Math.abs(RE_CONSTRUCTION_LOAN_LTC - RE_PERM_LOAN_LTV) < 1e-9
        ? [
            `⚠ The construction loan-to-cost and the permanent loan-to-value are both ${RE_PERM_LOAN_LTV * 100}%, which makes leverage EXACTLY multiple-neutral: (value − ${RE_PERM_LOAN_LTV}·value) ÷ (cost − ${RE_PERM_LOAN_LTV}·cost) is just value ÷ cost. So the levered and unlevered multiples are identical by construction, and a published levered multiple materially above the unlevered one cannot come from this capital structure.`,
          ]
        : []),
    ],
  }
}
