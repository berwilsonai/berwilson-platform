/**
 * Deal size, in every definition it has, and Ber Wilson's own share of it.
 *
 * ⚠ THE WHOLE POINT OF THIS MODULE IS THAT REVENUE GENERATED AND REVENUE TO
 * BER WILSON ARE DIFFERENT NUMBERS, OFTEN BY TWO ORDERS OF MAGNITUDE. Partners
 * consume much of the gross on these deals: a $3.5B internals package built by
 * Elite Solutions / Avant is revenue at the project and none of it is ours. A
 * $500M project where we earn a $20M fee is a $20M deal to Ber Wilson, and the
 * pipeline must roll up $20M.
 *
 * ⚠ AND AN UNKNOWN OWNERSHIP SPLIT MUST NEVER READ AS 100%. Financing partners
 * will take ownership inside these SPVs and the splits are not set yet, so a
 * line owned by an SPV with no split is reported as UNDETERMINED rather than
 * folded into the net figure. Showing it at full value would be the single most
 * expensive wrong number on the screen.
 *
 * Pure, no imports beyond sibling modules. Safe for a verification script.
 */

import { assetValue } from './costs'
import type { LineResult } from './lines'
import { weakestStatus, type ProvenanceStatus } from './provenance'
import type { Spv } from './types'

/**
 * A deal's size in every definition it has.
 *
 * ⚠ EVERY FIGURE IS NULLABLE, AND NULL IS NOT ZERO. When no line contributed a
 * contract value because none has a term yet, the answer is "not computed",
 * not "$0". Printing $0 beside a real annual figure reads as a fact about the
 * deal rather than as an unfinished model, and it is the same mistake as a bare
 * em dash at a value's own weight: the reader cannot tell a computed zero from
 * a failed one. A caller renders null by omitting the row or naming the absence
 * in words.
 */
export interface DealSize {
  /** Annual recurring revenue at stabilization, before escalation. */
  annualRecurringRevenue: number | null
  /** Recurring revenue summed over each line's term, escalation included. */
  contractValue: number | null
  oneTimeRevenue: number | null
  /** Money that is not revenue: 48E, 45X, 45Q. */
  taxCredits: number | null
  /** The capex view: what it costs to build, or the build contract. */
  totalProjectValue: number | null
  /** Annual NOI at stabilization, where operating cost is known. */
  annualNoi: number | null
  /** Capitalized NOI. Null without a cap rate or without a known NOI. */
  stabilizedAssetValue: number | null
  npv: number | null
  /** How many lines were in this tier at all, so an empty tier reads as empty. */
  lineCount: number
}

export const EMPTY_DEAL_SIZE: DealSize = {
  annualRecurringRevenue: null,
  contractValue: null,
  oneTimeRevenue: null,
  taxCredits: null,
  totalProjectValue: null,
  annualNoi: null,
  stabilizedAssetValue: null,
  npv: null,
  lineCount: 0,
}

/** Sum that stays null until something actually contributes to it. */
function add(current: number | null, value: number): number {
  return (current ?? 0) + value
}

export interface PerMwMetrics {
  annualRecurringRevenue: number | null
  contractValue: number | null
  oneTimeRevenue: number | null
  totalProjectValue: number | null
}

export interface WeightedLine {
  line: LineResult
  /** 0 to 1. Ber Wilson's share of the vehicle that earns this line. */
  weight: number
}

/**
 * Sum a set of weighted lines into one labelled deal size.
 *
 * `annualNoi` stays null unless at least one line reported one. A zero NOI from
 * lines that simply have no cost entered would make a margin look computed when
 * nobody has costed the deal.
 */
export function rollUp(
  weighted: WeightedLine[],
  capRatePct: number | null
): DealSize {
  let annualRecurringRevenue: number | null = null
  let contractValue: number | null = null
  let oneTimeRevenue: number | null = null
  let taxCredits: number | null = null
  let totalProjectValue: number | null = null
  let npvTotal: number | null = null
  let annualNoi: number | null = null

  for (const { line, weight } of weighted) {
    if (line.shape === 'recurring') {
      if (line.countsAsRevenue && line.annualRevenue != null) {
        annualRecurringRevenue = add(annualRecurringRevenue, line.annualRevenue * weight)
      }
      if (line.contractValue != null) {
        contractValue = add(contractValue, line.contractValue * weight)
      }
      if (line.annualNoi != null) annualNoi = add(annualNoi, line.annualNoi * weight)
    } else if (line.countsAsRevenue && line.oneTimeValue != null) {
      oneTimeRevenue = add(oneTimeRevenue, line.oneTimeValue * weight)
    }
    if (line.taxCreditValue != null) taxCredits = add(taxCredits, line.taxCreditValue * weight)
    if (line.projectValue != null) {
      totalProjectValue = add(totalProjectValue, line.projectValue * weight)
    }
    if (line.npv != null) npvTotal = add(npvTotal, line.npv * weight)
  }

  return {
    annualRecurringRevenue,
    contractValue,
    oneTimeRevenue,
    taxCredits,
    totalProjectValue,
    annualNoi,
    stabilizedAssetValue: assetValue(annualNoi, capRatePct),
    npv: npvTotal,
    lineCount: weighted.length,
  }
}

/** Every figure divided by firm MW, so deals of different size compare. */
export function perMw(size: DealSize, firmMw: number | null): PerMwMetrics {
  const over = (value: number | null): number | null =>
    value == null || firmMw == null || firmMw <= 0 ? null : value / firmMw
  return {
    annualRecurringRevenue: over(size.annualRecurringRevenue),
    contractValue: over(size.contractValue),
    oneTimeRevenue: over(size.oneTimeRevenue),
    totalProjectValue: over(size.totalProjectValue),
  }
}

export interface EntityRollup {
  spvId: string | null
  label: string
  purpose: string | null
  bwOwnershipPct: number | null
  gross: DealSize
  /** Null when this vehicle has no ownership split yet. */
  berWilsonNet: DealSize | null
  status: ProvenanceStatus | null
}

export interface CaptureTiers {
  /** Every line, whoever earns it. */
  grossGenerated: DealSize
  /** Lines tagged as ours, plus every fee and margin line. */
  berWilsonGross: DealSize
  /** Those lines times our share of the vehicle that earns each one. */
  berWilsonNet: DealSize
  /** Our lines whose vehicle has no split yet, at full value. Not in net. */
  undetermined: DealSize
  ownershipComplete: boolean
  spvsMissingOwnership: { id: string; label: string }[]
  /**
   * Our total value as a share of all the value on the deal, like for like.
   *
   * ⚠ NOT CAPTURE OVER TOTAL PROJECT VALUE. That comparison mixes a contract
   * total over fifteen years with a one-time build figure and returns things
   * like 172%, which is not a share of anything. This compares our contract
   * value, one-time revenue and credits against the gross of those same three.
   */
  capturePctOfGross: number | null
  /**
   * Our one-time revenue as a share of total project value: the fee-on-build
   * ratio. An $18M margin on a $150M contract is 12%. Both figures are one-time,
   * so this one is a real share.
   */
  captureOneTimePctOfProjectValue: number | null
  perMwGross: PerMwMetrics
  perMwCapture: PerMwMetrics
  status: ProvenanceStatus | null
}

/** A fee or margin line is capture whatever its own revenue flag says. */
export function isCapture(line: LineResult): boolean {
  return line.isBerWilsonRevenue || line.isCaptureLine
}

/**
 * Ber Wilson's share of the vehicle a line is earned in.
 *
 * A line with no SPV is earned by the parent company, which is wholly ours, so
 * its weight is 1. A line in a named SPV with no split has NO weight: it is
 * undetermined, and undetermined is not the same as all of it.
 */
export function ownershipWeight(
  line: LineResult,
  spvs: Map<string, Spv>
): { weight: number; determined: boolean } {
  if (line.spvId == null) return { weight: 1, determined: true }
  const spv = spvs.get(line.spvId)
  if (!spv) return { weight: 1, determined: true }
  if (spv.bwOwnershipPct == null) return { weight: 0, determined: false }
  return { weight: spv.bwOwnershipPct / 100, determined: true }
}

export function computeCaptureTiers(
  lines: LineResult[],
  spvList: Spv[],
  capRatePct: number | null,
  firmMw: number | null
): CaptureTiers {
  const spvs = new Map(spvList.map((s) => [s.id, s]))

  // ⚠ A CARVE-OUT IS NOT ADDITIONAL REVENUE AT THE PROJECT. Our $18M margin on
  // a $150M build is already inside the $150M, so gross generated is $150M. A
  // commission the owner pays on top of a package IS incremental and stays in.
  const grossGenerated = rollUp(
    lines.filter((line) => !line.isCarveOut).map((line) => ({ line, weight: 1 })),
    capRatePct
  )

  const ours = lines.filter(isCapture)
  const berWilsonGross = rollUp(
    ours.map((line) => ({ line, weight: 1 })),
    capRatePct
  )

  const determined: WeightedLine[] = []
  const undeterminedLines: WeightedLine[] = []
  const missing = new Map<string, string>()

  for (const line of ours) {
    const { weight, determined: known } = ownershipWeight(line, spvs)
    if (known) {
      determined.push({ line, weight })
    } else {
      undeterminedLines.push({ line, weight: 1 })
      const spv = line.spvId == null ? null : spvs.get(line.spvId)
      if (spv) missing.set(spv.id, spv.label)
    }
  }

  const berWilsonNet = rollUp(determined, capRatePct)
  const undetermined = rollUp(undeterminedLines, capRatePct)

  const tpv = grossGenerated.totalProjectValue
  const captureTotal =
    (berWilsonGross.contractValue ?? 0) +
    (berWilsonGross.oneTimeRevenue ?? 0) +
    (berWilsonGross.taxCredits ?? 0)
  const grossTotal =
    (grossGenerated.contractValue ?? 0) +
    (grossGenerated.oneTimeRevenue ?? 0) +
    (grossGenerated.taxCredits ?? 0)

  return {
    grossGenerated,
    berWilsonGross,
    berWilsonNet,
    undetermined,
    ownershipComplete: missing.size === 0,
    spvsMissingOwnership: Array.from(missing.entries()).map(([id, label]) => ({ id, label })),
    capturePctOfGross: grossTotal > 0 ? (captureTotal / grossTotal) * 100 : null,
    captureOneTimePctOfProjectValue:
      tpv != null && tpv > 0 && berWilsonGross.oneTimeRevenue != null
        ? (berWilsonGross.oneTimeRevenue / tpv) * 100
        : null,
    perMwGross: perMw(grossGenerated, firmMw),
    perMwCapture: perMw(berWilsonGross, firmMw),
    status: weakestStatus(lines.map((l) => l.status)),
  }
}

/** The same figures broken out by the vehicle that earns them. */
export function computeEntityRollups(
  lines: LineResult[],
  spvList: Spv[],
  capRatePct: number | null
): EntityRollup[] {
  const spvs = new Map(spvList.map((s) => [s.id, s]))
  const groups = new Map<string, LineResult[]>()
  for (const line of lines) {
    const key = line.spvId ?? ''
    const list = groups.get(key) ?? []
    list.push(line)
    groups.set(key, list)
  }

  const rollups: EntityRollup[] = []
  for (const [key, group] of groups) {
    const spv = key === '' ? null : spvs.get(key)
    const pct = spv ? spv.bwOwnershipPct : 100
    const gross = rollUp(
      group.map((line) => ({ line, weight: 1 })),
      capRatePct
    )
    rollups.push({
      spvId: key === '' ? null : key,
      label: spv ? spv.label : 'Ber Wilson Corporation',
      purpose: spv ? spv.purpose : null,
      bwOwnershipPct: pct,
      berWilsonNet:
        pct == null
          ? null
          : rollUp(
              group.filter(isCapture).map((line) => ({ line, weight: pct / 100 })),
              capRatePct
            ),
      gross,
      status: weakestStatus(group.map((l) => l.status)),
    })
  }

  return rollups.sort(
    (a, b) =>
      (b.gross.contractValue ?? b.gross.oneTimeRevenue ?? 0) -
      (a.gross.contractValue ?? a.gross.oneTimeRevenue ?? 0)
  )
}
