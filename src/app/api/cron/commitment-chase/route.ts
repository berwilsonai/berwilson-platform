/**
 * GET /api/cron/commitment-chase
 *
 * Keep the obligation ledger honest in both directions: compose the follow-up
 * for what the other side owes us, and retire what the conversation has moved
 * past. Driven by a launchd job once a day
 * (com.berwilson.cron-commitment-chase).
 *
 * 107 commitments were owed TO us when this was asked for and the chase was
 * being written by hand, or late, or not at all, while the local model sat
 * idle. This moves the writing to the idle resource and leaves the judgement —
 * and the send — with the person.
 *
 * ⚠ TIMING. One model call per commitment, capped at a dozen, sequential. It
 * runs at 05:30, well clear of the 06:30 brief / 06:50 note / 07:00 digest
 * block, because LM Studio serves one request at a time and a pass holding the
 * model is added to every other caller's wait (§12).
 *
 * ⚠ THE AGING PASS RIDES HERE, AND BELONGS HERE. The chase and the retirement
 * are the two halves of one question — is this obligation still alive — and
 * they have to agree about the order: a row must be chased BEFORE it can be
 * aged out, or Pepper closes things she never asked about. Running them in one
 * job in this order makes that true by construction rather than by two cron
 * times happening not to collide. It makes no model call, so it costs seconds.
 *
 * The token prune rides along for a different reason: it is one indexed delete,
 * it needs no particular hour, and a cron agent that exists to run a single
 * DELETE is a thing to maintain for no reason.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runChasePass } from '@/lib/commitments/chase'
import { runAgingPass } from '@/lib/commitments/aging'
import { pruneActionTokens } from '@/lib/commitments/tokens'

/** A dozen sequential local-model calls. Matches the other composing passes. */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dry') === '1'
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined

  // Chase first, then age — see the header. `?staleDays=` is for trying a
  // different bar against the live corpus without a deploy; the measured
  // default is in aging.ts and was chosen off scripts/one-shot/dry-aging.mts.
  const progress = await runChasePass({ dryRun, limit })

  const staleParam = Number(url.searchParams.get('staleDays'))
  const staleDays = Number.isFinite(staleParam) && staleParam > 0 ? staleParam : undefined
  const aging = await runAgingPass({ dryRun, staleDays })

  const tokensPruned = dryRun ? 0 : await pruneActionTokens()

  return NextResponse.json({
    ok: true,
    dryRun,
    ...progress,
    // Namespaced rather than spread: both passes have `considered`, `failed`
    // and `errors`, and §12's rule is that two quantities must be named apart.
    // Spreading them would have the aging pass's count silently overwrite the
    // chase's in the one place anybody reads either.
    aging,
    tokensPruned,
  })
}
