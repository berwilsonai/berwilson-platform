/**
 * POST /api/commitments/settle-link — record a verdict from a morning-note link.
 *
 * ⚠ PUBLIC, AND THE TOKEN IS THE WHOLE CREDENTIAL. This is in middleware's
 * public list because the reader may hold no session on their phone; it is
 * safe only because of what the token is — 32 random bytes, stored as a
 * sha256 hash, single-use, two-week expiry, delivered to the reader's own
 * mailbox, over a tailnet-only host. Every one of those properties is
 * load-bearing. Do not add a second way in here.
 *
 * ⚠ AND IT IS A POST FOR A REASON. Gmail prefetches links and the mail
 * gateways §12 records (Proofpoint/ATP/Inky) follow every URL in every message
 * to scan it, so the same logic behind a GET would have the ledger settled by a
 * robot overnight with the reader's name on every audit row. The GET at
 * /s/<token> renders a confirmation and changes nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  claimActionToken,
  releaseActionToken,
  type TokenAction,
} from '@/lib/commitments/tokens'
import { settleCommitment } from '@/lib/commitments/settle'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED: TokenAction[] = ['done', 'dismissed', 'snoozed']

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string
    verdict?: string
  }
  const token = typeof body.token === 'string' ? body.token : ''
  const verdict = body.verdict as TokenAction | undefined

  if (!token || token.length < 20 || token.length > 128) {
    return NextResponse.json({ error: 'Missing or malformed link' }, { status: 400 })
  }
  if (!verdict || !ALLOWED.includes(verdict)) {
    return NextResponse.json(
      { error: `verdict must be one of: ${ALLOWED.join(', ')}` },
      { status: 400 }
    )
  }

  // Claimed FIRST, atomically — the `used_at is null` predicate inside the
  // update is what makes a double-tap on a flaky phone connection settle once.
  const claim = await claimActionToken(token, verdict)
  if (!claim.ok) {
    const status = claim.reason === 'used' ? 409 : 404
    const message =
      claim.reason === 'used'
        ? 'This link has already been used.'
        : claim.reason === 'expired'
          ? 'This link has expired.'
          : 'We do not recognise this link.'
    return NextResponse.json({ error: message, reason: claim.reason }, { status })
  }

  /**
   * Who gets the credit.
   *
   * Resolved from the token's own `team_member_id` — the person the note was
   * addressed to — so a settlement from an email is attributable to a human and
   * not to "system". §12: user-initiated mutations must not land in the record
   * as the platform acting on its own.
   */
  let actor = 'morning note'
  if (claim.row.team_member_id) {
    const { data: member } = await createAdminClient()
      .from('team_members')
      .select('name')
      .eq('id', claim.row.team_member_id)
      .maybeSingle()
    if (member?.name) actor = `${member.name} (morning note)`
  }

  const result = await settleCommitment(claim.row.commitment_id, verdict, actor)

  if (!result.ok) {
    // ⚠ HAND THE LINK BACK. A burned token over a failed write leaves the
    // reader with an open commitment and a button that now says "already
    // settled" — the one combination that reads as the platform lying.
    await releaseActionToken(token)
    return NextResponse.json(
      { error: result.error ?? 'Could not record that' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    verdict,
    status: result.status,
    snoozedUntil: result.snoozedUntil ?? null,
  })
}
