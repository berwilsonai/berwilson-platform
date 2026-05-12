// Domain types for equity modeling tool

export interface SignedContract {
  name: string
  value: number
  termYears: number
  probability: number
  status: 'signed' | 'probable' | 'pipeline'
}

export interface ValuationInputs {
  // Signed contracts (feed into DCF)
  contracts: SignedContract[]

  // DCF overrides
  contractTermYears: number
  netMarginLow: number
  netMarginHigh: number
  executionProbability: number
  discountRate: number
  pipelineProbabilityWeightedValue: number
  pipelineDiscountYears: number

  // Comparable multiples
  revenueMultipleLow: number
  revenueMultipleHigh: number
  ebitdaMultipleLow: number
  ebitdaMultipleHigh: number
  stageDiscount: number
  strategicPremium: number

  // Asset/IP
  patents: {
    totalCount: number
    provisionalFiled: number
    nonProvisionalFiled: number
    granted: number
    commerciallyEvaluated: number
    valuePerProvisional: number
    valuePerNonProvisional: number
    valuePerGranted: number
    valuePerCommercial: number
  }
  tradeSecretsValue: number
  brandAndMarksValue: number
  certificationsValue: number
  relationshipsValue: number

  // Method weights
  weightDCF: number
  weightMultiples: number
  weightAssets: number
}

export interface CapTableHolder {
  name: string
  percentage: number
  role: string
  classB: boolean
  locked?: boolean
  vested?: number
}

export interface CapTableInputs {
  stage: string
  holders: CapTableHolder[]
}

export type NoteType = 'convertible_note' | 'safe' | 'preferred_equity_subsidiary'

export interface InvestorDealInputs {
  investorName: string
  investmentAmount: number
  noteType: NoteType
  valuationCap: number
  discount: number
  interestRate: number
  maturityMonths: number
  nextRoundValuation: number
  monthsUntilConversion: number
  advisorGrantPercentage: number
  maxParentEquityFromInvestment: number
  // Operational role (e.g., nonprofit executive director)
  operationalSalary: number
  operationalBonus: number
  operationalContractYears: number
  operationalSeverance: number
}

export interface OriginatorFeeTier {
  contractSizeMin: number
  contractSizeMax: number
  netProfitPercentage: number
  perDealCap: number
}

export interface SampleDeal {
  name: string
  contractRevenue: number
  durationYears: number
}

export interface OriginatorFeeInputs {
  tiers: OriginatorFeeTier[]
  netMarginAssumption: number
  sampleDeals: SampleDeal[]
  tailMonths: number
}

export interface ExitScenarioInputs {
  exitValuations: number[]
  exitYear: number
  ericPercentage: number
  hasLiquidationPreference: boolean
  investorInvestment: number
  investorPreferenceMultiple: number
  investorParticipating: boolean
  // Baseline "no funding" case
  baselineContractValue: number
  baselineTermYears: number
  baselineNetMargin: number
  baselineProbability: number
}

export interface Scenario {
  id: string
  user_id: string
  name: string
  description: string
  valuation_inputs: ValuationInputs
  cap_table_inputs: CapTableInputs
  investor_deal_inputs: InvestorDealInputs
  originator_fee_inputs: OriginatorFeeInputs
  exit_scenario_inputs: ExitScenarioInputs
  is_baseline: boolean
  created_at: string
  updated_at: string
}

// Calculation result types

export interface ValuationResult {
  dcf: { low: number; mid: number; high: number }
  multiples: { low: number; mid: number; high: number }
  assets: { low: number; mid: number; high: number }
  blended: { low: number; mid: number; high: number }
}

export interface ExitResult {
  exitValuation: number
  ericPayout: number
  ericPercentage: number
  investorPayout: number
  otherHoldersPayout: number
  baselineEricPayout: number
  netGain: number
  multiplier: number
}

export interface InvestorDealResult {
  equityAtConversion: number
  totalDilution: number
  investorEquityPercent: number
  totalPackageYear0: number
  totalPackageYear5: number
  totalPackageYear10: number
  lanes: {
    name: string
    valueYear0: number
    valueYear5: number
    valueYear10: number
  }[]
}

export interface OriginatorFeeResult {
  dealName: string
  contractRevenue: number
  netProfit: number
  originatorFee: number
  capApplied: boolean
  annualFee: number
  lifetimeFee: number
}
