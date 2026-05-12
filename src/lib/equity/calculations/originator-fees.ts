import type { OriginatorFeeTier, SampleDeal, OriginatorFeeResult } from '@/types/equity-domain'

/**
 * Calculate originator fee for a single deal using tiered structure
 */
export function calculateDealFee(
  deal: SampleDeal,
  tiers: OriginatorFeeTier[],
  netMarginAssumption: number
): OriginatorFeeResult {
  const netProfit = deal.contractRevenue * netMarginAssumption

  // Find the applicable tier
  const tier = tiers.find(
    (t) => deal.contractRevenue >= t.contractSizeMin && deal.contractRevenue < t.contractSizeMax
  ) ?? tiers[tiers.length - 1]

  const rawFee = netProfit * tier.netProfitPercentage
  const cappedFee = Math.min(rawFee, tier.perDealCap)
  const capApplied = rawFee > tier.perDealCap

  const annualFee = deal.durationYears > 0 ? cappedFee / deal.durationYears : cappedFee

  return {
    dealName: deal.name,
    contractRevenue: deal.contractRevenue,
    netProfit,
    originatorFee: cappedFee,
    capApplied,
    annualFee,
    lifetimeFee: cappedFee,
  }
}

/**
 * Calculate fees for all sample deals
 */
export function calculateAllDealFees(
  deals: SampleDeal[],
  tiers: OriginatorFeeTier[],
  netMarginAssumption: number
): OriginatorFeeResult[] {
  return deals.map((deal) => calculateDealFee(deal, tiers, netMarginAssumption))
}

/**
 * Calculate total lifetime originator fees across all deals
 */
export function calculateTotalLifetimeFees(results: OriginatorFeeResult[]): number {
  return results.reduce((sum, r) => sum + r.lifetimeFee, 0)
}
