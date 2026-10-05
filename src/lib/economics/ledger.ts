/**
 * The capacity allocation ledger: every megawatt from source to use.
 *
 * ⚠ THE HARD RULE IS THAT ALLOCATIONS MAY NOT EXCEED FIRM MW, AND AN OVERAGE
 * BLOCKS. It does not prorate, scale down, or quietly take the smaller figure.
 * Silently fitting 160 MW of commitments into 100 MW of plant is how a deal
 * gets signed twice over the same capacity, so the engine refuses and names the
 * 10 MW rather than producing a number.
 *
 * ⚠ AND SIZING TO AVERAGE LOAD WHILE IGNORING PEAK IS A KNOWN FAILURE IN THE
 * EXISTING MODELS. Peak above firm is surfaced as a warning wherever peak data
 * has been entered, because the ledger adds average loads and a plant has to
 * serve the coincident peak.
 *
 * Pure, no imports beyond sibling modules. Safe for a verification script.
 */

import type { CapacityBucket, CapacitySource } from './types'
import { weakestStatus, type ProvenanceStatus } from './provenance'

export interface CapacityDraw {
  lineId: string
  lineLabel: string
  bucketId: string | null
  /**
   * Facility megawatts. For a data center line this is already IT MW times
   * PUE: the ledger holds what actually draws on the plant, never the IT
   * figure, or the cooling load is invisible to every total.
   */
  facilityMw: number
  /** Peak, when the line states one. Averages add; peaks are compared. */
  peakMw: number | null
}

/** The row unbucketed draws land in when a model defines no ledger at all. */
export const UNALLOCATED_BUCKET_ID = '__unallocated__'

export interface SourceFirmResult {
  sourceId: string
  label: string
  nameplateMw: number | null
  firmMw: number | null
  /** How firm was arrived at, so a reader can see a block design was used. */
  basis: 'block_design' | 'nameplate' | 'none'
  blocksInService: number | null
  /** Set when a block design and a stated net figure disagree. */
  statedNetMismatch: { stated: number; derived: number } | null
  missing: string[]
}

export interface BucketResult {
  bucketId: string
  label: string
  priority: number
  allocatedMw: number
  peakMw: number | null
  lines: { lineId: string; lineLabel: string; facilityMw: number }[]
}

export interface LedgerResult {
  nameplateMw: number | null
  firmMw: number | null
  allocatedMw: number
  /** Firm less allocated. Negative is the overage and is reported separately. */
  surplusMw: number | null
  /** Allocated average load over firm, as a percent. Null without firm. */
  utilizationPct: number | null
  /** Sum of stated peaks, compared against firm. */
  peakMw: number | null
  sources: SourceFirmResult[]
  buckets: BucketResult[]
  /** Megawatts allocated beyond firm. Null when there is no overage. */
  overageMw: number | null
  /** Draws naming a bucket that does not exist. Blocks: the MW go nowhere. */
  orphanedDraws: { lineId: string; lineLabel: string; bucketId: string | null }[]
  /**
   * True when the model defines no buckets at all, so there is no allocation
   * ledger to enforce.
   *
   * ⚠ THIS IS THE DIFFERENCE BETWEEN A DEAL MODEL AND A BACK-OF-ENVELOPE CALC,
   * AND CONFLATING THEM MAKES THE SCRATCHPAD PERMANENTLY INVALID. A saved deal
   * seeds the priority buckets and a drawing line that names none is an error:
   * its load is in no total. A quick calc on a phone is MW and one price, with
   * no ledger in play, so its draws still add up against firm capacity but
   * belong to nobody and nothing refuses them. A warning says the ledger is
   * absent; it does not pretend one was violated.
   */
  noBuckets: boolean
  status: ProvenanceStatus | null
}

/**
 * Firm capacity for one source.
 *
 * A complete block design wins over a nameplate figure, because the block
 * design is the statement of how the plant is built: 24 blocks of 50 MW with 4
 * redundant is 1,000 MW firm whatever a summary sheet says the nameplate is.
 * Availability derates whatever basis was used, and null availability means no
 * derate is claimed rather than zero availability.
 */
export function sourceFirmMw(source: CapacitySource): SourceFirmResult {
  const missing: string[] = []
  const hasBlocks =
    source.blockCount != null && source.blockMw != null && Number.isFinite(source.blockCount) &&
    Number.isFinite(source.blockMw)

  let nameplate: number | null = null
  let firm: number | null = null
  let basis: SourceFirmResult['basis'] = 'none'
  let blocksInService: number | null = null

  if (hasBlocks) {
    const total = source.blockCount as number
    const size = source.blockMw as number
    const redundant = source.redundantBlocks ?? 0
    blocksInService = Math.max(0, total - redundant)
    nameplate = total * size
    firm = blocksInService * size
    basis = 'block_design'
  } else if (source.nameplateMw != null && Number.isFinite(source.nameplateMw)) {
    nameplate = source.nameplateMw
    firm = source.nameplateMw
    basis = 'nameplate'
  } else {
    missing.push('Nameplate MW, or a block count and block size')
  }

  if (firm != null && source.availabilityPct != null && Number.isFinite(source.availabilityPct)) {
    firm = firm * (source.availabilityPct / 100)
  }

  let statedNetMismatch: SourceFirmResult['statedNetMismatch'] = null
  if (
    firm != null &&
    source.statedNetMw != null &&
    Number.isFinite(source.statedNetMw) &&
    Math.abs(source.statedNetMw - firm) > 0.5
  ) {
    statedNetMismatch = { stated: source.statedNetMw, derived: firm }
  }

  return {
    sourceId: source.id,
    label: source.label,
    nameplateMw: nameplate,
    firmMw: firm,
    basis,
    blocksInService,
    statedNetMismatch,
    missing,
  }
}

/**
 * Build the ledger from sources, buckets and the draws the lines produced.
 *
 * Firm MW is null when no source could be computed at all. Null is not zero:
 * zero firm would make every allocation an overage and bury the real problem,
 * which is that nobody has said how big the plant is.
 */
export function buildLedger(
  sources: CapacitySource[],
  buckets: CapacityBucket[],
  draws: CapacityDraw[]
): LedgerResult {
  const sourceResults = sources.map(sourceFirmMw)
  const computed = sourceResults.filter((s) => s.firmMw != null)

  const firmMw = computed.length > 0 ? computed.reduce((sum, s) => sum + (s.firmMw ?? 0), 0) : null
  const nameplateMw =
    sourceResults.some((s) => s.nameplateMw != null)
      ? sourceResults.reduce((sum, s) => sum + (s.nameplateMw ?? 0), 0)
      : null

  const byId = new Map<string, BucketResult>()
  for (const bucket of buckets) {
    byId.set(bucket.id, {
      bucketId: bucket.id,
      label: bucket.label,
      priority: bucket.priority,
      allocatedMw: 0,
      peakMw: bucket.peakMw,
      lines: [],
    })
  }

  const noBuckets = buckets.length === 0
  if (noBuckets) {
    // No ledger in play. The draws still have to add up against firm capacity,
    // so they land in one unallocated row rather than being discarded.
    byId.set(UNALLOCATED_BUCKET_ID, {
      bucketId: UNALLOCATED_BUCKET_ID,
      label: 'Unallocated',
      priority: 1000,
      allocatedMw: 0,
      peakMw: null,
      lines: [],
    })
  }

  const orphanedDraws: LedgerResult['orphanedDraws'] = []
  for (const draw of draws) {
    if (draw.facilityMw <= 0) continue
    const bucket =
      noBuckets
        ? byId.get(UNALLOCATED_BUCKET_ID)
        : draw.bucketId == null
          ? undefined
          : byId.get(draw.bucketId)
    if (!bucket) {
      orphanedDraws.push({
        lineId: draw.lineId,
        lineLabel: draw.lineLabel,
        bucketId: draw.bucketId,
      })
      continue
    }
    bucket.allocatedMw += draw.facilityMw
    bucket.lines.push({
      lineId: draw.lineId,
      lineLabel: draw.lineLabel,
      facilityMw: draw.facilityMw,
    })
  }

  const bucketResults = Array.from(byId.values()).sort((a, b) => a.priority - b.priority)
  const allocatedMw = bucketResults.reduce((sum, b) => sum + b.allocatedMw, 0)

  const statedPeaks = draws
    .map((d) => d.peakMw)
    .concat(buckets.map((b) => b.peakMw))
    .filter((v): v is number => v != null && Number.isFinite(v))
  const peakMw = statedPeaks.length > 0 ? statedPeaks.reduce((a, b) => a + b, 0) : null

  const surplusMw = firmMw == null ? null : firmMw - allocatedMw
  const overageMw = surplusMw != null && surplusMw < -1e-9 ? -surplusMw : null
  const utilizationPct = firmMw != null && firmMw > 0 ? (allocatedMw / firmMw) * 100 : null

  return {
    nameplateMw,
    firmMw,
    allocatedMw,
    surplusMw,
    utilizationPct,
    peakMw,
    sources: sourceResults,
    buckets: bucketResults,
    overageMw,
    orphanedDraws,
    noBuckets,
    status: weakestStatus(sources.map((s) => s.status)),
  }
}
