/**
 * One-tap settlement links for Pepper's morning note.
 *
 * THE PROBLEM THIS SOLVES. The note is read on a phone at 06:50 and its only
 * two controls are links to tailnet-only pages. Measured 2026-10-09: across
 * eleven mornings of notes naming them, not one of 476 open commitments had
 * ever been settled by a human. A ledger whose close action lives two
 * navigations away from where it is read does not get closed.
 *
 * ⚠ A LINK IN AN EMAIL IS FETCHED BY THINGS THAT ARE NOT THE READER. Gmail
 * prefetches, and the mail gateways whose link wrappers §12 already records
 * (Proofpoint/ATP/Inky) follow every URL in every message in order to scan it.
 * So NOTHING here acts on a GET: the token opens a confirmation page, and the
 * verdict is a POST from that page. A scanner can open the page all day and
 * change nothing. The cost is one extra tap; the alternative is a ledger
 * settled by a robot with Richard's name on every row.
 *
 * THE TOKEN IS THE CREDENTIAL, so only its hash is stored. The note lives in a
 * mailbox forever, and a readable token column would make this table a set of
 * working keys to the ledger. Possession of 32 random bytes delivered to your
 * own mailbox is the authentication — and the app is tailnet-only besides, so
 * the link is unreachable from the open internet in the first place.
 */

import { createHash, randomBytes } from 'node:crypto'
import { sweepDb } from '@/lib/email-sweep/db'
import type { Tables } from '@/lib/supabase/types'
import type { CommitmentRow } from './db'

export type TokenAction = 'done' | 'dismissed' | 'snoozed'

export type ActionTokenRow = Tables<'commitment_action_tokens'>

/**
 * How long a link stays live.
 *
 * The note is daily, so a fortnight-old link settling something today is more
 * likely a mis-tap in an old thread than an intention. Long enough to survive a
 * holiday, short enough that the mailbox is not a permanent key ring.
 */
export const TOKEN_TTL_DAYS = 14

/** How many days a snooze buys. One working week — the note is weekdays only. */
export const SNOOZE_DAYS = 7

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Mint one token per (commitment, reader) and hand back the raw string.
 *
 * Deliberately ONE token covering all three verdicts rather than one per
 * action: the page is where the choice is made, so the reader gets done /
 * not-mine / snooze from a single tap in the note, and the table grows by one
 * row per named commitment per day rather than three.
 */
export async function mintActionToken(
  commitmentId: string,
  teamMemberId: string | null
): Promise<string | null> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000)

  const { error } = await sweepDb()
    .from('commitment_action_tokens')
    .insert({
      token_hash: hash(token),
      commitment_id: commitmentId,
      team_member_id: teamMemberId,
      expires_at: expires.toISOString(),
    })

  // A link that cannot be minted costs that row its button, never the note.
  if (error) {
    console.error(`[commitment-tokens] could not mint for ${commitmentId}: ${error.message}`)
    return null
  }
  return token
}

/** Why a token cannot be acted on, in words a reader can understand. */
export type TokenRejection = 'not_found' | 'expired' | 'used' | 'gone'

export interface ResolvedToken {
  row: ActionTokenRow
  commitment: CommitmentRow
}

/**
 * Look a token up WITHOUT consuming it — what the confirmation page renders.
 *
 * Returns the rejection reason rather than null so the page can say which of
 * "we have never seen this link", "it has expired" and "you already settled
 * this" is true. A single "invalid link" message would have the reader assume
 * the platform is broken in the one case where it is working perfectly.
 */
export async function resolveActionToken(
  token: string
): Promise<{ ok: true; data: ResolvedToken } | { ok: false; reason: TokenRejection }> {
  const { data, error } = await sweepDb()
    .from('commitment_action_tokens')
    .select('*, commitment:commitments(*)')
    .eq('token_hash', hash(token))
    .maybeSingle()

  if (error) {
    console.error(`[commitment-tokens] lookup failed: ${error.message}`)
    return { ok: false, reason: 'not_found' }
  }
  if (!data) return { ok: false, reason: 'not_found' }

  const row = data as ActionTokenRow & { commitment: CommitmentRow | null }
  // The FK cascades, so a deleted commitment takes its tokens with it; this
  // arm covers the embed coming back empty for any other reason.
  if (!row.commitment) return { ok: false, reason: 'gone' }
  if (row.used_at) return { ok: false, reason: 'used' }
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' }

  return { ok: true, data: { row, commitment: row.commitment } }
}

/**
 * Claim a token for one verdict. Atomic, so a double-tap settles once.
 *
 * The `used_at is null` predicate inside the UPDATE is what makes this safe
 * without a transaction: Postgres serialises the two writers, the loser matches
 * no row, and `maybeSingle()` hands back nothing. Checking first and writing
 * second would race — and the race is a phone on a flaky connection firing the
 * same POST twice, which is the normal case rather than the exotic one.
 */
export async function claimActionToken(
  token: string,
  action: TokenAction
): Promise<{ ok: true; row: ActionTokenRow } | { ok: false; reason: TokenRejection }> {
  const existing = await resolveActionToken(token)
  if (!existing.ok) return existing

  const { data, error } = await sweepDb()
    .from('commitment_action_tokens')
    .update({ used_at: new Date().toISOString(), used_action: action })
    .eq('token_hash', hash(token))
    .is('used_at', null)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error(`[commitment-tokens] claim failed: ${error.message}`)
    return { ok: false, reason: 'not_found' }
  }
  if (!data) return { ok: false, reason: 'used' }
  return { ok: true, row: data as ActionTokenRow }
}

/**
 * Hand a claimed token back when the verdict it was claimed for did not land.
 *
 * Without this a failed settle burns the link, and the reader is left with a
 * commitment that is still open and a button that now says "already settled" —
 * the one combination that reads as the platform lying to them.
 */
export async function releaseActionToken(token: string): Promise<void> {
  const { error } = await sweepDb()
    .from('commitment_action_tokens')
    .update({ used_at: null, used_action: null })
    .eq('token_hash', hash(token))
  if (error) console.error(`[commitment-tokens] could not release: ${error.message}`)
}

/**
 * Drop spent and expired rows. Called by the chase cron, which already runs
 * daily — a sweep with nothing to clean costs one indexed delete.
 */
export async function pruneActionTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - TOKEN_TTL_DAYS * 86_400_000).toISOString()
  const { data, error } = await sweepDb()
    .from('commitment_action_tokens')
    .delete()
    .lt('expires_at', cutoff)
    .select('id')
  if (error) {
    console.error(`[commitment-tokens] prune failed: ${error.message}`)
    return 0
  }
  return data?.length ?? 0
}
