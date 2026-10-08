/**
 * How much of a vehicle is ours, and whether the splits add up.
 *
 * ⚠ PURE. No database, no environment — `npm test` and the verification scripts
 * load this with neither, and src/lib/economics/store.ts calls it while mapping
 * rows. Keep it that way: a shared lib no script can load is one nothing can
 * verify (CLAUDE.md §12).
 *
 * THE WHOLE POINT OF THIS FILE is that "our share" had two possible homes once
 * a participant ledger existed — the number someone typed on the vehicle and
 * the row flagged as us in the ledger — and two homes for one quantity is how a
 * reader ends up trusting neither (§12, one quantity one definition). So the
 * ledger wins when it exists, the typed value serves the simple case, and every
 * answer says WHICH it came from so the screen can tell the reader.
 */

import { weakestStatus, type ProvenanceStatus } from '@/lib/economics/provenance'
import { formatMoney } from '@/lib/utils/constants'
import { SPV_PURPOSE_LABELS } from '@/lib/economics/types'
import type { ProjectSpv, SpvParticipant } from './types'

/** Where a vehicle's Ber Wilson share came from. */
export type ShareSource =
  /** The participant flagged `is_ber_wilson` carries an equity %. */
  | 'ledger'
  /** No participants, so the figure typed on the vehicle stands. */
  | 'typed'
  /** Nobody has said, either way. Reported as undetermined, never as 0 or 100. */
  | 'none'

export interface BwShare {
  pct: number | null
  from: ShareSource
  /**
   * True when a typed `bw_ownership_pct` exists but the ledger is answering
   * instead. The screen shows the typed figure as SUPERSEDED rather than
   * dropping it silently: filling a blank and overwriting a value are different
   * acts, and so are ignoring a number and saying you ignored it (§12).
   */
  typedSuperseded: boolean
}

/**
 * Our share of a vehicle.
 *
 * ⚠ A LEDGER WITH NO BER WILSON ROW RETURNS NULL, NOT THE RESIDUE. Inferring
 * our share as 100 minus the others assumes the ledger is complete, and a
 * half-entered cap table is the normal state of a live negotiation — so the
 * inference would report a confident figure precisely when nobody has decided.
 * An unknown share is held out of the net total by the engine, which is the
 * honest answer; a guessed one is counted.
 */
export function resolveBwShare(
  spv: Pick<ProjectSpv, 'bwOwnershipPct'>,
  participants: readonly Pick<SpvParticipant, 'isBerWilson' | 'equityPct'>[]
): BwShare {
  const typed = spv.bwOwnershipPct

  if (participants.length === 0) {
    return { pct: typed, from: typed == null ? 'none' : 'typed', typedSuperseded: false }
  }

  const ours = participants.find((p) => p.isBerWilson)
  const pct = ours?.equityPct ?? null
  return {
    pct,
    from: pct == null ? 'none' : 'ledger',
    typedSuperseded: typed != null,
  }
}

export interface ParticipantTotals {
  /** Null when no participant carries an equity %. */
  equityPct: number | null
  /** Null when no participant carries a commitment. */
  committed: number | null
  /** Null when no participant carries a funded figure. */
  funded: number | null
  /** How many rows contributed to each total, so a caller can say "2 of 3". */
  withEquity: number
  withCommitted: number
  withFunded: number
}

/**
 * The column totals under a participant ledger.
 *
 * ⚠ A SUM WITH NOTHING IN IT IS NULL, NOT 0 (§12, 10-05). A vehicle with three
 * partners and no capital figures yet must not print "$0 committed" beside a
 * real equity split — that reads as computed rather than unfinished, and it is
 * a statement about the deal that nobody made.
 */
export function participantTotals(
  participants: readonly Pick<
    SpvParticipant,
    'equityPct' | 'capitalCommitted' | 'capitalFunded'
  >[]
): ParticipantTotals {
  let equity = 0
  let committed = 0
  let funded = 0
  let withEquity = 0
  let withCommitted = 0
  let withFunded = 0

  for (const p of participants) {
    if (p.equityPct != null) {
      equity += p.equityPct
      withEquity += 1
    }
    if (p.capitalCommitted != null) {
      committed += p.capitalCommitted
      withCommitted += 1
    }
    if (p.capitalFunded != null) {
      funded += p.capitalFunded
      withFunded += 1
    }
  }

  return {
    equityPct: withEquity > 0 ? round(equity, 4) : null,
    committed: withCommitted > 0 ? round(committed, 2) : null,
    funded: withFunded > 0 ? round(funded, 2) : null,
    withEquity,
    withCommitted,
    withFunded,
  }
}

/**
 * How much of the raise target is still to place. Null unless BOTH a target and
 * a commitment total exist — a figure against a missing target is not a gap, it
 * is an unknown, and printing the committed figure as "the gap" would be wrong
 * by the whole target.
 */
export function stillToPlace(
  raiseTarget: number | null,
  committed: number | null
): number | null {
  if (raiseTarget == null || committed == null) return null
  return round(raiseTarget - committed, 2)
}

/**
 * The weakest status in a vehicle — its own and every participant's.
 *
 * A vehicle marked `contracted` whose third partner is still a planning
 * assumption is not contracted, and reading the vehicle's own status alone
 * launders exactly that. Null when the vehicle has no status to report, which a
 * caller renders as unknown rather than as strong.
 */
export function effectiveSpvStatus(
  spv: Pick<ProjectSpv, 'status'>,
  participants: readonly Pick<SpvParticipant, 'status'>[]
): ProvenanceStatus | null {
  return weakestStatus([spv.status, ...participants.map((p) => p.status)])
}

/**
 * What is wrong with a vehicle's splits, in sentences a reader can act on.
 *
 * ⚠ REPORTS, NEVER BLOCKS. A cap table is half-entered for most of a
 * negotiation's life, and refusing to save an 85% ledger would mean the second
 * partner could not be recorded until the third was agreed. The engine already
 * holds an unknown share out of the net total rather than guessing it, so an
 * incomplete ledger costs a warning and never a wrong number.
 */
export function splitWarnings(
  spv: Pick<ProjectSpv, 'label' | 'purpose' | 'bwOwnershipPct' | 'raiseTarget'>,
  participants: readonly SpvParticipant[]
): string[] {
  const out: string[] = []
  if (participants.length === 0) return out

  const name = spv.label || SPV_PURPOSE_LABELS[spv.purpose]
  const totals = participantTotals(participants)

  if (totals.equityPct == null) {
    out.push(
      `${name} has ${participants.length} participant${participants.length === 1 ? '' : 's'} and no equity split on any of them, so our share of it is undetermined.`
    )
  } else if (Math.abs(totals.equityPct - 100) > 0.01) {
    const delta = round(100 - totals.equityPct, 4)
    out.push(
      delta > 0
        ? `${name} splits total ${fmtPct(totals.equityPct)}. ${fmtPct(delta)} is unassigned.`
        : `${name} splits total ${fmtPct(totals.equityPct)}, which is ${fmtPct(-delta)} more than the whole vehicle.`
    )
  }

  // ⚠ "NOBODY IS FLAGGED" AND "THE FLAGGED ROW HAS NO SPLIT" ARE DIFFERENT
  // FACTS, AND THIS ONCE REPORTED THE SECOND AS THE FIRST. The condition was
  // `share.pct == null`, which is true in BOTH cases — so a vehicle whose Ber
  // Wilson row was correctly flagged but had no percentage yet was told "no
  // participant is marked as Ber Wilson", a sentence that is simply untrue of
  // the record and sends the reader hunting for a flag that is already set. It
  // also duplicated the warning directly above it. Caught by seeding the Delta
  // vehicles, which is precisely the shape it misreports: a flagged sponsor row
  // with the split not yet agreed is the normal state of a live negotiation.
  const share = resolveBwShare(spv, participants)
  const ours = participants.find((p) => p.isBerWilson)
  if (!ours) {
    out.push(
      `No participant in ${name} is marked as Ber Wilson, so its revenue is reported as undetermined rather than as ours.`
    )
  } else if (ours.equityPct == null && totals.equityPct != null) {
    // Only worth saying when the OTHERS carry splits — when nobody does, the
    // first warning has already said it, and two sentences about one gap is how
    // a warning list stops being read.
    out.push(
      `${ours.holderName} is marked as Ber Wilson in ${name} but carries no equity split, so our share of it is undetermined rather than the remainder of the others.`
    )
  }
  if (share.typedSuperseded && share.from === 'ledger' && spv.bwOwnershipPct !== share.pct) {
    out.push(
      `${name} carries a typed share of ${fmtPct(spv.bwOwnershipPct!)} and a ledger that says ${fmtPct(share.pct!)}. The ledger is the one being used.`
    )
  }

  // A commitment total above the target is not an error — an oversubscribed
  // raise is good news — but it is worth saying, because the usual cause is a
  // figure entered against the wrong vehicle.
  const gap = stillToPlace(spv.raiseTarget, totals.committed)
  if (gap != null && gap < 0) {
    out.push(
      `${name} has more committed than its raise target by ${formatMoney(-gap)}. Worth checking the figure landed on the right vehicle.`
    )
  }

  return out
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Trailing zeros dropped: "35%", not "35.0000%". */
function fmtPct(value: number): string {
  return `${Number(value.toFixed(4))}%`
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RAISE PIPELINE. A second ledger, deliberately never summed with the first.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One commitment from the capital-raise pipeline (`investments`).
 *
 * Numbers, not PostgREST strings: the coercion happens at the read in
 * ./portfolio.ts so this file stays pure and loadable with no database.
 */
export interface Commitment {
  investorId: string
  indicated: number | null
  committed: number | null
  funded: number | null
}

/**
 * What the capital-raise pipeline holds against a vehicle.
 *
 * ⚠ THIS IS NOT THE CAP TABLE AND MUST NEVER BE ADDED TO IT. `investments` is
 * the relationship over time — who we are talking to, what they have indicated,
 * what stage it is at. `project_spv_participants` is who actually holds what,
 * and it is the only thing `resolveBwShare` reads. The same dollar can
 * legitimately appear in both — an investor still in discussion who is already
 * on the cap table — so adding them reports a raise larger than either truth
 * and belonging to neither (§12, one quantity one definition).
 *
 * Every figure is nullable: a sum with nothing in it is null, not 0.
 */
export interface VehiclePipeline {
  investorCount: number
  indicated: number | null
  committed: number | null
  funded: number | null
  /**
   * How many of those investors are already rows on the cap table. This is the
   * number that makes the two ledgers readable side by side: "4 investors, 2
   * not yet on the cap table" is actionable where two totals are just
   * confusing.
   */
  onCapTable: number
}

const EMPTY_PIPELINE: VehiclePipeline = {
  investorCount: 0,
  indicated: null,
  committed: null,
  funded: null,
  onCapTable: 0,
}

/**
 * The raise pipeline for one vehicle, with nothing summed into the ledger.
 *
 * ⚠ INVESTORS ARE COUNTED DISTINCTLY, NOT ROWS. One investor can hold several
 * commitment rows against the same vehicle (a first cheque and a follow-on), so
 * counting rows would report four investors where there are two — and "how many
 * people are in this raise" is exactly the figure an executive repeats out loud.
 */
export function summarizePipeline(
  commitments: readonly Commitment[],
  participants: readonly Pick<SpvParticipant, 'investorId'>[]
): VehiclePipeline {
  if (commitments.length === 0) return EMPTY_PIPELINE

  const ledgerInvestors = new Set(
    participants.map((p) => p.investorId).filter((id): id is string => id != null)
  )

  let indicated: number | null = null
  let committed: number | null = null
  let funded: number | null = null
  const add = (total: number | null, value: number | null) =>
    value == null ? total : (total ?? 0) + value

  for (const row of commitments) {
    indicated = add(indicated, row.indicated)
    committed = add(committed, row.committed)
    funded = add(funded, row.funded)
  }

  return {
    investorCount: new Set(commitments.map((r) => r.investorId)).size,
    indicated,
    committed,
    funded,
    onCapTable: new Set(
      commitments.map((r) => r.investorId).filter((id) => ledgerInvestors.has(id))
    ).size,
  }
}
