/**
 * POST /api/email-ingestion/dedupe — fold intake proposals about the same deal
 * into one.
 *
 * ⚠ THIS PASS HAD NO DOOR. `dedupePendingSessions` was written on 2026-09-14,
 * measured on the live backlog (104 proposals -> 59 groups, 0 duplicates, 0
 * invalid) and then fixed twice — without ever being imported by anything. It
 * ran from a scratch script that was never committed, so from the app there was
 * no way to reach it at all. Measured again on 2026-10-08: 109 pending
 * proposals marked `create`, including TEN about Steelton and SIX about Myton.
 * Confirming those as they stand creates ten Steelton projects, which is the
 * exact outcome the pass exists to prevent.
 *
 * WHY A BUTTON AND NOT A SWEEP PHASE. A wrong merge is the one outcome here
 * with no undo (dedupe.ts says so at the point it validates), and the human
 * confirm step is downstream of this, not around it — by the time somebody sees
 * the survivor it is an ordinary proposal that looks like it always covered the
 * whole deal. So the grouping is something a person asks for and reads, never
 * something that happens overnight. `dry_run` exists to be used first.
 *
 * ⚠ LONG BY NATURE, which is why maxDuration is set like the Pepper route's
 * rather than the 300s default. The grouping is ONE model call over every
 * pending proposal (~4.6 minutes at 104 entries on the local model) and each
 * group then costs a re-analysis of its combined correspondence. LM Studio
 * serves one request at a time, so this queues behind any cron that is running.
 */

import { NextRequest } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { dedupePendingSessions } from '@/lib/email-ingestion/dedupe'

export const maxDuration = 1800

interface DedupeBody {
  dry_run?: boolean
  budget_ms?: number
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: DedupeBody = {}
  try {
    body = (await request.json()) as DedupeBody
  } catch {
    // An empty body is a dry run — the safe default for a pass with no undo.
  }

  const dryRun = body.dry_run !== false

  try {
    const progress = await dedupePendingSessions({
      dryRun,
      budgetMs: body.budget_ms,
      userId: viewer.authUserId,
    })
    return Response.json({ success: true, ...progress })
  } catch (err) {
    // dedupe.ts throws rather than half-acting when the grouping is unusable
    // (an invented or double-counted ordinal). Nothing was changed; say so.
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'The grouping pass failed.',
        changed: false,
      },
      { status: 500 }
    )
  }
}
