// Ber Wilson defaults — all values from the Partnership Strategy document
import type { SignedContract } from '@/types/equity-domain'

export const ERIC_OWNERSHIP_FLOOR = 51.0

export const DEFAULT_CONTRACTS: SignedContract[] = [
  { name: 'USACE IDIQ (Signed)', value: 20_000_000, termYears: 10, probability: 0.95, status: 'signed' },
  { name: 'USACE Task Order Upside', value: 15_000_000, termYears: 10, probability: 0.60, status: 'probable' },
  { name: 'Box Elder Stratos Elk Quantum Campus', value: 300_000_000, termYears: 10, probability: 0.15, status: 'pipeline' },
  { name: 'Hospital Expansion (West Wendover)', value: 250_000_000, termYears: 8, probability: 0.10, status: 'pipeline' },
  { name: 'NuScale SMR', value: 3_000_000_000, termYears: 15, probability: 0.05, status: 'pipeline' },
  { name: 'Silver Corridor Rail', value: 500_000_000, termYears: 12, probability: 0.08, status: 'pipeline' },
]

export const VALUATION_DEFAULTS = {
  contractTermYears: 10,
  netMarginLow: 0.08,
  netMarginMid: 0.12,
  netMarginHigh: 0.15,
  executionProbability: 0.85,
  discountRate: 0.25,
  pipelineProbabilityWeightedValue: 50_000_000,
  pipelineDiscountYears: 5,
  revenueMultipleLow: 0.5,
  revenueMultipleHigh: 1.5,
  ebitdaMultipleLow: 5,
  ebitdaMultipleHigh: 10,
  stageDiscount: 0.4,
  strategicPremium: 2.0,
  patents: {
    totalCount: 200,
    provisionalFiled: 0,
    nonProvisionalFiled: 0,
    granted: 0,
    commerciallyEvaluated: 0,
    valuePerProvisional: 5_000,
    valuePerNonProvisional: 50_000,
    valuePerGranted: 150_000,
    valuePerCommercial: 750_000,
  },
  tradeSecretsValue: 2_000_000,
  brandAndMarksValue: 500_000,
  certificationsValue: 1_000_000,
  relationshipsValue: 1_500_000,
  weightDCF: 0.4,
  weightMultiples: 0.3,
  weightAssets: 0.3,
}

export const CAP_TABLE_STAGES = {
  stage0: {
    name: 'Stage 0 — Today',
    holders: [
      { name: 'Eric Tua\'one', percentage: 100.0, role: 'Founder/CEO', classB: true },
    ],
  },
  stage1: {
    name: 'Stage 1 — Partner Joins',
    holders: [
      { name: 'Eric Tua\'one', percentage: 95.0, role: 'Founder/CEO', classB: true },
      { name: 'Partner (EVP)', percentage: 5.0, role: 'EVP', classB: false },
    ],
  },
  stage2: {
    name: 'Stage 2 — First Investment',
    holders: [
      { name: 'Eric Tua\'one', percentage: 90.3, role: 'Founder/CEO', classB: true },
      { name: 'Partner (EVP)', percentage: 4.7, role: 'EVP', classB: false },
      { name: 'Investor (Note Conversion)', percentage: 5.0, role: 'Investor', classB: false },
    ],
  },
  stage3: {
    name: 'Stage 3 — Option Pool',
    holders: [
      { name: 'Eric Tua\'one', percentage: 76.7, role: 'Founder/CEO', classB: true },
      { name: 'Partner (EVP)', percentage: 4.0, role: 'EVP', classB: false },
      { name: 'Investor (Equity)', percentage: 5.0, role: 'Investor', classB: false },
      { name: 'Investor (Advisor)', percentage: 0.7, role: 'Advisor', classB: false },
      { name: 'Option Pool', percentage: 13.6, role: 'Pool', classB: false },
    ],
  },
  stage4: {
    name: 'Stage 4 — Key Hires',
    holders: [
      { name: 'Eric Tua\'one', percentage: 76.7, role: 'Founder/CEO', classB: true },
      { name: 'Partner (EVP)', percentage: 4.0, role: 'EVP', classB: false },
      { name: 'Investor (Equity)', percentage: 5.0, role: 'Investor', classB: false },
      { name: 'Investor (Advisor)', percentage: 0.7, role: 'Advisor', classB: false },
      { name: 'COO', percentage: 3.5, role: 'Executive', classB: false },
      { name: 'CFO', percentage: 2.0, role: 'Executive', classB: false },
      { name: 'General Counsel', percentage: 1.0, role: 'Executive', classB: false },
      { name: 'Option Pool (Remaining)', percentage: 7.1, role: 'Pool', classB: false },
    ],
  },
}

export const INVESTOR_DEAL_DEFAULTS = {
  investorName: 'Investor',
  investmentAmount: 1_000_000,
  noteType: 'convertible_note' as const,
  valuationCap: 20_000_000,
  discount: 0.20,
  interestRate: 0.055,
  maturityMonths: 24,
  nextRoundValuation: 30_000_000,
  monthsUntilConversion: 18,
  advisorGrantPercentage: 0.75,
  maxParentEquityFromInvestment: 0.10,
  operationalSalary: 300_000,
  operationalBonus: 50_000,
  operationalContractYears: 5,
  operationalSeverance: 6,
}

export const ORIGINATOR_FEE_TIERS = [
  { contractSizeMin: 0, contractSizeMax: 10_000_000, netProfitPercentage: 0.05, perDealCap: 250_000 },
  { contractSizeMin: 10_000_000, contractSizeMax: 100_000_000, netProfitPercentage: 0.03, perDealCap: 1_500_000 },
  { contractSizeMin: 100_000_000, contractSizeMax: 1_000_000_000, netProfitPercentage: 0.02, perDealCap: 10_000_000 },
  { contractSizeMin: 1_000_000_000, contractSizeMax: Infinity, netProfitPercentage: 0.01, perDealCap: 25_000_000 },
]

export const SAMPLE_DEALS = [
  { name: 'Box Elder Stratos Elk Quantum Campus', contractRevenue: 300_000_000, durationYears: 10 },
  { name: 'Hospital Expansion (West Wendover)', contractRevenue: 250_000_000, durationYears: 8 },
  { name: 'NuScale SMR', contractRevenue: 3_000_000_000, durationYears: 15 },
  { name: 'Silver Corridor Rail', contractRevenue: 500_000_000, durationYears: 12 },
]

export const EXIT_DEFAULTS = {
  exitValuation: 200_000_000,
  exitYear: 5,
  ericPercentage: 51.0,
  baselineContractValue: 20_000_000,
  baselineTermYears: 10,
  baselineNetMargin: 0.12,
  baselineProbability: 0.70,
}

export const LEGAL_DISCLAIMER =
  'This tool provides modeling assumptions and scenario analysis for internal planning purposes only. It does not constitute legal, tax, financial, or investment advice. All equity, valuation, and partnership decisions must be reviewed and approved by qualified legal and tax counsel before execution.'
