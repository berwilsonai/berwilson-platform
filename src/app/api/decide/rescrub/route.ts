/**
 * "Have another look at where these belong."
 *
 * Admin-only and human-pressed. The pass behind it changes a RECOMMENDATION
 * and nothing else — see the header of `src/lib/decide/rescrub.ts` — so this is
 * not a mutation route in the sense §11 cares about: no record is created, no
 * conversation is filed, no session is confirmed or dismissed.
 *
 * ⚠ NOT A CRON, DELIBERATELY. It is one model call per pending session against
 * a box that serves one request at a time, and a queue of four does not need
 * re-asking hourly. It runs when somebody looks at the queue and thinks the
 * answers are stale — which is also the moment they are about to act on them.
 */

import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { rescrubPendingSessions } from '@/lib/decide/rescrub'

export const maxDuration = 300

export async function POST() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  try {
    const progress = await rescrubPendingSessions({
      userId: viewer.authUserId,
      // Under the route's own 300s ceiling with room to answer: a run that is
      // killed mid-flight has still committed every session it finished, since
      // each is written as it is decided.
      budgetMs: 4 * 60 * 1000,
    })
    return Response.json(progress)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not re-check the queue.' },
      { status: 500 }
    )
  }
}
