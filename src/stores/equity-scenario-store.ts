'use client'

import { create } from 'zustand'
import type {
  ValuationInputs,
  CapTableInputs,
  InvestorDealInputs,
  OriginatorFeeInputs,
  ExitScenarioInputs,
} from '@/types/equity-domain'
import {
  VALUATION_DEFAULTS,
  DEFAULT_CONTRACTS,
  CAP_TABLE_STAGES,
  INVESTOR_DEAL_DEFAULTS,
  ORIGINATOR_FEE_TIERS,
  SAMPLE_DEALS,
  EXIT_DEFAULTS,
} from '@/lib/equity/constants'

export function getDefaultValuationInputs(): ValuationInputs {
  return {
    contracts: DEFAULT_CONTRACTS.map((c) => ({ ...c })),
    contractTermYears: VALUATION_DEFAULTS.contractTermYears,
    netMarginLow: VALUATION_DEFAULTS.netMarginLow,
    netMarginHigh: VALUATION_DEFAULTS.netMarginHigh,
    executionProbability: VALUATION_DEFAULTS.executionProbability,
    discountRate: VALUATION_DEFAULTS.discountRate,
    pipelineProbabilityWeightedValue: VALUATION_DEFAULTS.pipelineProbabilityWeightedValue,
    pipelineDiscountYears: VALUATION_DEFAULTS.pipelineDiscountYears,
    revenueMultipleLow: VALUATION_DEFAULTS.revenueMultipleLow,
    revenueMultipleHigh: VALUATION_DEFAULTS.revenueMultipleHigh,
    ebitdaMultipleLow: VALUATION_DEFAULTS.ebitdaMultipleLow,
    ebitdaMultipleHigh: VALUATION_DEFAULTS.ebitdaMultipleHigh,
    stageDiscount: VALUATION_DEFAULTS.stageDiscount,
    strategicPremium: VALUATION_DEFAULTS.strategicPremium,
    patents: { ...VALUATION_DEFAULTS.patents },
    tradeSecretsValue: VALUATION_DEFAULTS.tradeSecretsValue,
    brandAndMarksValue: VALUATION_DEFAULTS.brandAndMarksValue,
    certificationsValue: VALUATION_DEFAULTS.certificationsValue,
    relationshipsValue: VALUATION_DEFAULTS.relationshipsValue,
    weightDCF: VALUATION_DEFAULTS.weightDCF,
    weightMultiples: VALUATION_DEFAULTS.weightMultiples,
    weightAssets: VALUATION_DEFAULTS.weightAssets,
  }
}

export function getDefaultCapTableInputs(): CapTableInputs {
  return {
    stage: 'stage4',
    holders: CAP_TABLE_STAGES.stage4.holders.map((h) => ({ ...h, locked: h.classB, vested: h.classB ? 100 : 0 })),
  }
}

export function getDefaultInvestorDealInputs(): InvestorDealInputs {
  return { ...INVESTOR_DEAL_DEFAULTS }
}

export function getDefaultOriginatorFeeInputs(): OriginatorFeeInputs {
  return {
    tiers: ORIGINATOR_FEE_TIERS.map((t) => ({ ...t })),
    netMarginAssumption: 0.12,
    sampleDeals: SAMPLE_DEALS.map((d) => ({ ...d })),
    tailMonths: 18,
  }
}

export function getDefaultExitScenarioInputs(): ExitScenarioInputs {
  return {
    exitValuations: [50_000_000, 100_000_000, 200_000_000, 500_000_000, 1_000_000_000],
    exitYear: EXIT_DEFAULTS.exitYear,
    ericPercentage: EXIT_DEFAULTS.ericPercentage,
    hasLiquidationPreference: true,
    investorInvestment: 1_000_000,
    investorPreferenceMultiple: 1.0,
    investorParticipating: false,
    baselineContractValue: EXIT_DEFAULTS.baselineContractValue,
    baselineTermYears: EXIT_DEFAULTS.baselineTermYears,
    baselineNetMargin: EXIT_DEFAULTS.baselineNetMargin,
    baselineProbability: EXIT_DEFAULTS.baselineProbability,
  }
}

interface ScenarioState {
  activeScenarioId: string | null
  activeScenarioName: string
  valuation: ValuationInputs
  capTable: CapTableInputs
  investorDeal: InvestorDealInputs
  originatorFees: OriginatorFeeInputs
  exitScenarios: ExitScenarioInputs
  isDirty: boolean

  setActiveScenario: (id: string | null, name: string) => void
  setValuation: (partial: Partial<ValuationInputs>) => void
  setCapTable: (partial: Partial<CapTableInputs>) => void
  setInvestorDeal: (partial: Partial<InvestorDealInputs>) => void
  setOriginatorFees: (partial: Partial<OriginatorFeeInputs>) => void
  setExitScenarios: (partial: Partial<ExitScenarioInputs>) => void
  loadScenario: (data: {
    id: string
    name: string
    valuation_inputs: ValuationInputs
    cap_table_inputs: CapTableInputs
    nancy_deal_inputs: InvestorDealInputs
    originator_fee_inputs: OriginatorFeeInputs
    exit_scenario_inputs: ExitScenarioInputs
  }) => void
  resetToDefaults: () => void
  markClean: () => void
}

export const useScenarioStore = create<ScenarioState>((set) => ({
  activeScenarioId: null,
  activeScenarioName: 'New Scenario',
  valuation: getDefaultValuationInputs(),
  capTable: getDefaultCapTableInputs(),
  investorDeal: getDefaultInvestorDealInputs(),
  originatorFees: getDefaultOriginatorFeeInputs(),
  exitScenarios: getDefaultExitScenarioInputs(),
  isDirty: false,

  setActiveScenario: (id, name) => set({ activeScenarioId: id, activeScenarioName: name }),
  setValuation: (partial) =>
    set((s) => ({ valuation: { ...s.valuation, ...partial }, isDirty: true })),
  setCapTable: (partial) =>
    set((s) => ({ capTable: { ...s.capTable, ...partial }, isDirty: true })),
  setInvestorDeal: (partial) =>
    set((s) => ({ investorDeal: { ...s.investorDeal, ...partial }, isDirty: true })),
  setOriginatorFees: (partial) =>
    set((s) => ({ originatorFees: { ...s.originatorFees, ...partial }, isDirty: true })),
  setExitScenarios: (partial) =>
    set((s) => ({ exitScenarios: { ...s.exitScenarios, ...partial }, isDirty: true })),
  loadScenario: (data) =>
    set({
      activeScenarioId: data.id,
      activeScenarioName: data.name,
      valuation: { ...getDefaultValuationInputs(), ...data.valuation_inputs },
      capTable: { ...getDefaultCapTableInputs(), ...data.cap_table_inputs },
      investorDeal: { ...getDefaultInvestorDealInputs(), ...data.nancy_deal_inputs },
      originatorFees: { ...getDefaultOriginatorFeeInputs(), ...data.originator_fee_inputs },
      exitScenarios: { ...getDefaultExitScenarioInputs(), ...data.exit_scenario_inputs },
      isDirty: false,
    }),
  resetToDefaults: () =>
    set({
      valuation: getDefaultValuationInputs(),
      capTable: getDefaultCapTableInputs(),
      investorDeal: getDefaultInvestorDealInputs(),
      originatorFees: getDefaultOriginatorFeeInputs(),
      exitScenarios: getDefaultExitScenarioInputs(),
      isDirty: true,
    }),
  markClean: () => set({ isDirty: false }),
}))
