import type { ValuationInputs, ValuationResult } from '@/types/equity-domain'

/**
 * Compute total signed/probable contract value from the contracts array.
 */
function getContractTotals(inputs: ValuationInputs): { minimum: number; ceiling: number } {
  const signed = inputs.contracts.filter((c) => c.status === 'signed')
  const probable = inputs.contracts.filter((c) => c.status === 'probable')
  const pipeline = inputs.contracts.filter((c) => c.status === 'pipeline')

  // Minimum: only signed contracts at full value
  const minimum = signed.reduce((sum, c) => sum + c.value * c.probability, 0)

  // Ceiling: signed + probable + pipeline weighted by probability
  const ceiling =
    signed.reduce((sum, c) => sum + c.value * c.probability, 0) +
    probable.reduce((sum, c) => sum + c.value * c.probability, 0) +
    pipeline.reduce((sum, c) => sum + c.value * c.probability, 0)

  return { minimum, ceiling }
}

/**
 * Method 1: DCF on signed and probable revenue
 */
export function calculateDCF(inputs: ValuationInputs): { low: number; mid: number; high: number } {
  const { minimum, ceiling } = getContractTotals(inputs)

  const annualRevenueMin = minimum / inputs.contractTermYears
  const annualRevenueMax = ceiling / inputs.contractTermYears

  const npvLow =
    annualRevenueMin * inputs.netMarginLow * inputs.executionProbability / inputs.discountRate
  const npvHigh =
    annualRevenueMax * inputs.netMarginHigh * inputs.executionProbability / inputs.discountRate
  const npvMid = (npvLow + npvHigh) / 2

  const pipelineContrib =
    inputs.pipelineProbabilityWeightedValue /
    Math.pow(1 + inputs.discountRate, inputs.pipelineDiscountYears)

  return {
    low: npvLow,
    mid: npvMid + pipelineContrib * 0.5,
    high: npvHigh + pipelineContrib,
  }
}

/**
 * Method 2: Comparable transaction multiples
 */
export function calculateMultiples(inputs: ValuationInputs): { low: number; mid: number; high: number } {
  const { minimum } = getContractTotals(inputs)
  const annualRevenue = minimum / inputs.contractTermYears

  const revLow = annualRevenue * inputs.revenueMultipleLow * (1 - inputs.stageDiscount)
  const revHigh =
    annualRevenue *
    inputs.revenueMultipleHigh *
    inputs.strategicPremium *
    (1 - inputs.stageDiscount * 0.5)

  const ebitda = annualRevenue * ((inputs.netMarginLow + inputs.netMarginHigh) / 2)
  const ebitdaLow = ebitda * inputs.ebitdaMultipleLow * (1 - inputs.stageDiscount)
  const ebitdaHigh = ebitda * inputs.ebitdaMultipleHigh * inputs.strategicPremium

  return {
    low: Math.min(revLow, ebitdaLow),
    mid: (revLow + revHigh + ebitdaLow + ebitdaHigh) / 4,
    high: Math.max(revHigh, ebitdaHigh),
  }
}

/**
 * Method 3: Asset and IP-based valuation
 */
export function calculateAssets(inputs: ValuationInputs): { low: number; mid: number; high: number } {
  const { patents } = inputs

  const unfiledCount =
    patents.totalCount -
    patents.provisionalFiled -
    patents.nonProvisionalFiled -
    patents.granted -
    patents.commerciallyEvaluated

  const patentValue =
    patents.provisionalFiled * patents.valuePerProvisional +
    patents.nonProvisionalFiled * patents.valuePerNonProvisional +
    patents.granted * patents.valuePerGranted +
    patents.commerciallyEvaluated * patents.valuePerCommercial +
    unfiledCount * 1_000

  const otherAssets =
    inputs.tradeSecretsValue +
    inputs.brandAndMarksValue +
    inputs.certificationsValue +
    inputs.relationshipsValue

  const total = patentValue + otherAssets

  return {
    low: total * 0.3,
    mid: total,
    high: total * 3,
  }
}

/**
 * Blended valuation using weighted average of all three methods
 */
export function calculateBlendedValuation(inputs: ValuationInputs): ValuationResult {
  const dcf = calculateDCF(inputs)
  const multiples = calculateMultiples(inputs)
  const assets = calculateAssets(inputs)

  const blendedLow =
    dcf.low * inputs.weightDCF +
    multiples.low * inputs.weightMultiples +
    assets.low * inputs.weightAssets

  const blendedMid =
    dcf.mid * inputs.weightDCF +
    multiples.mid * inputs.weightMultiples +
    assets.mid * inputs.weightAssets

  const blendedHigh =
    dcf.high * inputs.weightDCF +
    multiples.high * inputs.weightMultiples +
    assets.high * inputs.weightAssets

  return {
    dcf,
    multiples,
    assets,
    blended: { low: blendedLow, mid: blendedMid, high: blendedHigh },
  }
}

/**
 * Reverse calculator: given investment and target equity %, what must the valuation be?
 */
export function reverseCalculation(
  investment: number,
  targetEquityPercent: number
): number {
  if (targetEquityPercent <= 0) return Infinity
  return investment / (targetEquityPercent / 100)
}
