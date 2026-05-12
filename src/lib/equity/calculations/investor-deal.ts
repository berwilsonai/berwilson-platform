import type { InvestorDealInputs, InvestorDealResult } from '@/types/equity-domain'

/**
 * Calculate investor's equity percentage at conversion.
 * They get the better of: valuation cap or discount.
 */
export function calculateConversionEquity(inputs: InvestorDealInputs): number {
  const principal = inputs.investmentAmount

  if (inputs.noteType === 'convertible_note') {
    const monthlyRate = inputs.interestRate / 12
    const accruedInterest = principal * monthlyRate * inputs.monthsUntilConversion
    const totalPrincipal = principal + accruedInterest

    const priceViaCap = inputs.valuationCap / inputs.nextRoundValuation
    const priceViaDiscount = 1 - inputs.discount

    const conversionRatio = Math.min(priceViaCap, priceViaDiscount)
    const effectiveValuation = inputs.nextRoundValuation * conversionRatio
    const equityPercent = (totalPrincipal / effectiveValuation) * 100

    return Math.min(equityPercent, inputs.maxParentEquityFromInvestment * 100)
  }

  if (inputs.noteType === 'safe') {
    const priceViaCap = inputs.valuationCap / inputs.nextRoundValuation
    const priceViaDiscount = 1 - inputs.discount
    const conversionRatio = Math.min(priceViaCap, priceViaDiscount)
    const effectiveValuation = inputs.nextRoundValuation * conversionRatio
    const equityPercent = (principal / effectiveValuation) * 100

    return Math.min(equityPercent, inputs.maxParentEquityFromInvestment * 100)
  }

  // Preferred equity at subsidiary — direct percentage
  const equityPercent = (principal / inputs.valuationCap) * 100
  return Math.min(equityPercent, inputs.maxParentEquityFromInvestment * 100)
}

/**
 * Calculate the full investor deal package across all 5 lanes.
 */
export function calculateInvestorDealResult(
  inputs: InvestorDealInputs,
  exitValuation: number = 200_000_000,
  originatorFeeLifetime: number = 4_500_000
): InvestorDealResult {
  const equityPct = calculateConversionEquity(inputs)
  const advisorPct = inputs.advisorGrantPercentage

  // Lane 1: Investment equity
  const lane1Year0 = inputs.investmentAmount
  const lane1Year5 = (equityPct / 100) * exitValuation
  const lane1Year10 = (equityPct / 100) * exitValuation * 2

  // Lane 2: Advisor grant
  const lane2Year0 = (advisorPct / 100) * inputs.valuationCap
  const lane2Year5 = (advisorPct / 100) * exitValuation
  const lane2Year10 = (advisorPct / 100) * exitValuation * 2

  // Lane 3: Originator fees
  const lane3Year0 = 0
  const lane3Year5 = originatorFeeLifetime * 0.5
  const lane3Year10 = originatorFeeLifetime

  // Lane 4: Operational salary
  const annualComp = inputs.operationalSalary + inputs.operationalBonus
  const lane4Year0 = 0
  const lane4Year5 = annualComp * Math.min(5, inputs.operationalContractYears)
  const lane4Year10 = annualComp * Math.min(10, inputs.operationalContractYears)

  // Lane 5: Board seat (no dollar value)
  const lane5Year0 = 0
  const lane5Year5 = 0
  const lane5Year10 = 0

  const totalEquityPct = equityPct + advisorPct
  const totalDilution = totalEquityPct

  return {
    equityAtConversion: equityPct,
    totalDilution,
    investorEquityPercent: totalEquityPct,
    totalPackageYear0: lane1Year0 + lane2Year0,
    totalPackageYear5: lane1Year5 + lane2Year5 + lane3Year5 + lane4Year5,
    totalPackageYear10: lane1Year10 + lane2Year10 + lane3Year10 + lane4Year10,
    lanes: [
      { name: 'Convertible Note Equity', valueYear0: lane1Year0, valueYear5: lane1Year5, valueYear10: lane1Year10 },
      { name: 'Advisor Grant', valueYear0: lane2Year0, valueYear5: lane2Year5, valueYear10: lane2Year10 },
      { name: 'Originator Fees', valueYear0: lane3Year0, valueYear5: lane3Year5, valueYear10: lane3Year10 },
      { name: 'Operational Salary', valueYear0: lane4Year0, valueYear5: lane4Year5, valueYear10: lane4Year10 },
      { name: 'Board Seat', valueYear0: lane5Year0, valueYear5: lane5Year5, valueYear10: lane5Year10 },
    ],
  }
}
