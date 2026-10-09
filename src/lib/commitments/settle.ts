/**
 * Apply a verdict to a commitment. The ONE place that writes one.
 *
 * Three callers reach this: the authenticated PATCH route, the token-authed
 * POST behind a morning-note link, and the commitments page. §12 — never fork a
 * shared pass per caller; add a parameter. Here the parameter is WHO decided,
 * because that is the only thing the three paths genuinely disagree about.
 *
 * Lives in src/lib rather than behind the route for the standing reason: an
 * agent tool or a backfill script must be able to settle without fetching the
 * app's own HTTP routes.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import { HUMAN_SETTLED, type CommitmentStatus } from './db'
import { SNOOZE_DAYS } from './tokens'

/** The verdicts a human may record. `open` is the undo. */
export type Verdict = 'done' | 'dismissed' | 'snoozed' | 'open'

export const VERDICTS: Verdict[] = ['done', 'dismissed', 'snoozed', 'open']

export interface SettleResult {
  ok: boolean
  status?: CommitmentStatus
  snoozedUntil?: string | null
  error?: string
}

function isoDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

/**
 * Record a verdict.
 *
 * ⚠ SNOOZE IS NOT A STATUS AND MUST NOT BECOME ONE. The row stays `open`: it
 * stays on the ledger, stays in every count, and stays true. Only the shouting
 * stops, until the date. Modelling it as a status would make "how much do we
 * owe" depend on how recently somebody wanted a quiet morning — and §12's rule
 * about `resolved` versus the human verdicts exists precisely because a machine
 * re-reading the thread may rewrite a status it did not set.
 *
 * ⚠ AND THE COLUMNS A VERDICT GOVERNS TRAVEL TOGETHER. Settling clears any
 * snooze and snoozing clears any settlement, because a row carrying both says
 * two different things about itself and whichever a reader checks first wins
 * (§12, on discriminators and partial writes).
 */
export async function settleCommitment(
  id: string,
  verdict: Verdict,
  settledBy: string
): Promise<SettleResult> {
  const patch =
    verdict === 'open'
      ? // The undo: no closer, no quiet. A row that kept its settler would
        // carry somebody who has not looked at it since.
        { status: 'open' as const, settled_at: null, settled_by: null, snoozed_until: null }
      : verdict === 'snoozed'
        ? {
            status: 'open' as const,
            settled_at: null,
            settled_by: null,
            snoozed_until: isoDate(SNOOZE_DAYS),
          }
        : {
            status: verdict,
            settled_at: new Date().toISOString(),
            settled_by: settledBy,
            snoozed_until: null,
          }

  const { data, error } = await sweepDb()
    .from('commitments')
    .update(patch)
    .eq('id', id)
    // Selected back so a miss is a miss, not a 200 that silently did nothing.
    .select('id, status, snoozed_until')
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Commitment not found' }

  const row = data as { status: string; snoozed_until: string | null }
  return {
    ok: true,
    status: row.status as CommitmentStatus,
    snoozedUntil: row.snoozed_until,
  }
}

/** Whether a status is one a person set, and so must never be overwritten. */
export function isHumanSettled(status: CommitmentStatus): boolean {
  return HUMAN_SETTLED.includes(status)
}
