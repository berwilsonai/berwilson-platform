/**
 * GET /api/cron/commitment-chase
 *
 * Compose the follow-up for what the other side owes us, leave it where the
 * reader can send it, and never send it. Driven by a launchd job once a day
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
 * The token prune rides along here rather than in its own job: it is one
 * indexed delete, it needs no particular hour, and a cron agent that exists to
 * run a single DELETE is a thing to maintain for no reason.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runChasePass } from '@/lib/commitments/chase'
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

  const progress = await runChasePass({ dryRun, limit })
  const tokensPruned = dryRun ? 0 : await pruneActionTokens()

  return NextResponse.json({ ok: true, dryRun, ...progress, tokensPruned })
}
