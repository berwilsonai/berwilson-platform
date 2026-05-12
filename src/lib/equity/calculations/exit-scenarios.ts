import type { ExitScenarioInputs, ExitResult } from '@/types/equity-domain'

/**
 * Calculate the "100% of nothing" baseline:
 * Eric keeps 100%, company only executes the signed contract,
 * no growth, no additional contracts.
 */
export function calculateBaselinePayout(inputs: ExitScenarioInputs): number {
  const annualRevenue = inputs.baselineContractValue / inputs.baselineTermYears
  const totalProfit =
    annualRevenue *
    inputs.baselineNetMargin *
    inputs.baselineProbability *
    inputs.baselineTermYears
  return totalProfit
}

/**
 * Calculate exit results for a single exit valuation.
 */
export function calculateExitResult(
  exitValuation: number,
  inputs: ExitScenarioInputs
): ExitResult {
  const ericPct = inputs.ericPercentage / 100
  const investorEquityPct = inputs.investorInvestment / (inputs.investorInvestment > 0 ? 20_000_000 : 1)

  let investorPayout = 0
  if (inputs.hasLiquidationPreference && inputs.investorInvestment > 0) {
    const liquidationPref = inputs.investorInvestment * inputs.investorPreferenceMultiple
    const equityValue = exitValuation * investorEquityPct

    if (inputs.investorParticipating) {
      investorPayout = liquidationPref + (exitValuation - liquidationPref) * investorEquityPct
    } else {
      investorPayout = Math.max(liquidationPref, equityValue)
    }
  } else {
    investorPayout = exitValuation * investorEquityPct
  }

  const ericPayout = exitValuation * ericPct
  const otherHoldersPayout = exitValuation - ericPayout - investorPayout

  const baselineEricPayout = calculateBaselinePayout(inputs)
  const netGain = ericPayout - baselineEricPayout
  const multiplier = baselineEricPayout > 0 ? ericPayout / baselineEricPayout : 0

  return {
    exitValuation,
    ericPayout,
    ericPercentage: inputs.ericPercentage,
    investorPayout,
    otherHoldersPayout: Math.max(0, otherHoldersPayout),
    baselineEricPayout,
    netGain,
    multiplier,
  }
}

/**
 * Calculate exit results for all modeled valuations.
 */
export function calculateAllExitResults(
  inputs: ExitScenarioInputs
): ExitResult[] {
  return inputs.exitValuations.map((v) => calculateExitResult(v, inputs))
}

/**
 * Generate the "Eric's Reality Check" text.
 */
export function generateRealityCheckText(result: ExitResult): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n)

  return `At a ${fmt(result.exitValuation)} exit valuation, your ${result.ericPercentage.toFixed(0)}% stake is worth ${fmt(result.ericPayout)}. If you had kept 100% but couldn't fund growth, your maximum lifetime company profit on the signed contract alone is approximately ${fmt(result.baselineEricPayout)}. The cost of giving up ${(100 - result.ericPercentage).toFixed(0)}% to fund the company is: net positive ${fmt(result.netGain)}.`
}
