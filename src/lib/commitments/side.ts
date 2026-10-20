/**
 * Correct the side of an obligation whose named owner is one of ours.
 *
 * ⚠ THE MODEL SETS `side` AND `owner_name` INDEPENDENTLY AND NOTHING CHECKED
 * THEM AGAINST EACH OTHER. Measured 2026-10-19 over the live ledger: 32 of 164
 * open `side='them'` rows name Richard or Eric as the owner — "Draft and send
 * MOU to TensorIQ for legal review — Ericson Tua'one", "Fill in blanks for
 * Steelton funding and equity share — Eric". Every one of them is our work
 * sitting in the "Waiting on" column, so 20% of what reads as a follow-up list
 * is the executive's own to-do, and the chase pass would compose a
 * counterparty nudge for it.
 *
 * §12 already carries the rule this breaks — "a mailbox is a better key than a
 * name, and check what the field MEANS on each side, or resolving `side='them'`
 * says someone owes themselves". `attribute()` in pepper/attribution.ts even
 * documents the symptom ("lands on Richard's waiting-on list as something
 * Richard owes himself") and works around it at READ time by refusing to
 * resolve the name when the side is `them`. That keeps the row off the wrong
 * desk and leaves it in the wrong column, which is the half the reader sees.
 * This is the write-time fix the workaround was standing in for.
 *
 * ⚠ IT CORRECTS IN ONE DIRECTION ONLY. `them` → `us` when the owner is
 * demonstrably ours; never `us` → `them`, because the extractor already errs
 * toward `them` by design (see extract-phase.ts: "the failure mode is a
 * follow-up we did not need to chase, rather than silently adopting someone
 * else's obligation as work") and reversing that here would undo a deliberate
 * choice using a weaker signal than the one that made it.
 *
 * The matching is `resolveOwnerName`, not a new name test — §12: grep for a
 * matcher before building one. It already refuses an ambiguous or
 * too-short token, which is what keeps a counterparty called Eric from being
 * adopted as ours on a four-letter first name alone.
 */

import { resolveOwnerName, type PepperMember } from '@/lib/pepper/attribution'

export interface SideCorrection {
  /** Index into the array handed in, so the caller can report which moved. */
  index: number
  ownerName: string
  memberId: string
}

/**
 * Flip `them` → `us` for every row whose owner resolves to a team member.
 *
 * Pure and index-based so the extraction phase, the backfill script and the
 * test all agree on exactly which rows move and why — the same reason
 * `agingVerdict` is pure.
 */
export function correctSides<T extends { side: 'us' | 'them'; owner_name: string | null }>(
  rows: T[],
  members: PepperMember[]
): { rows: T[]; corrections: SideCorrection[] } {
  const corrections: SideCorrection[] = []

  const out = rows.map((row, index) => {
    if (row.side !== 'them') return row
    const owner = row.owner_name
    if (!owner?.trim()) return row

    const match = resolveOwnerName(owner, members)
    if (!match) return row

    corrections.push({ index, ownerName: owner.trim(), memberId: match.memberId })
    return { ...row, side: 'us' as const }
  })

  return { rows: out, corrections }
}
