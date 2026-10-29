import { NextRequest, NextResponse } from 'next/server'
import { syncDriveKnowledge } from '@/lib/knowledge/drive-sync'
import { syncProjectFolders } from '@/lib/drive/project-folder-sync'
import { isDriveConfigured } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { notifyArrivals } from '@/lib/notifications/documents'
import { deferredResponse, interactiveRunInFlight } from '@/lib/ai/run-state'
import { publishAllTrackers } from '@/lib/dataroom/tracker'

/**
 * GET /api/cron/drive-sync
 *
 * Three phases, all reading Drive:
 *   1. Index the nominated knowledge folder into the company knowledge base,
 *      which is what the fit assessor cites as evidence.
 *   2. Re-import every project's linked Drive folder, so documents the team
 *      files in Drive reach the project instead of only living there — and post
 *      one update per project saying what arrived and what it is about.
 *   3. Re-publish `00.2 — Master Document Index & Outstanding Items` into every
 *      data-room deal's own folder, so the index a partner reads is never older
 *      than the documents it indexes.
 *
 * ⚠ PHASE 3 IS LAST AND IT IS WHY IT IS HERE RATHER THAN ON A CRON OF ITS OWN.
 * It has to run AFTER the import, because the tracker reads `drive_folder_path`
 * and the import is what writes it — a tracker published before the import
 * reports yesterday's structure. Sharing the endpoint also avoids §12's
 * "a new cron route is unreachable until middleware.ts names it", which
 * typechecks, builds, registers, then 401s at its scheduled hour.
 *
 * Nightly, via com.berwilson.cron-drive-sync. Phase 2 runs even when no
 * knowledge folder is configured — a promoted project's folder is not optional
 * infrastructure the way the knowledge library is.
 *
 * An unconfigured knowledge folder is not an error — it is optional, and a
 * failure in the cron log every night would be noise.
 */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Stand aside while somebody is waiting on a Ber AI answer.
  //
  // LM Studio serves ONE request at a time (§2), so starting a model-heavy
  // pass now is added directly to the wait of whoever asked. This pass
  // checkpoints, so the next scheduled tick picks up where it left off and
  // nothing is lost by yielding. `?force=1` overrides.
  const waitingOnAnswer = await interactiveRunInFlight()
  if (waitingOnAnswer.busy && !request.nextUrl.searchParams.get('force')) {
    return NextResponse.json(deferredResponse('drive-sync', waitingOnAnswer))
  }


  if (!isGoogleConfigured()) {
    return NextResponse.json({
      skipped: true,
      reason: 'Google Workspace is not configured.',
    })
  }

  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 20 * 60 * 1000
  const deadline = Date.now() + budgetMs

  let knowledge: Awaited<ReturnType<typeof syncDriveKnowledge>> | { skipped: true; reason: string }
  try {
    knowledge = isDriveConfigured()
      ? await syncDriveKnowledge({ budgetMs: Math.floor(budgetMs * 0.6) })
      : {
          skipped: true,
          reason: 'No knowledge folder configured (GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID).',
        }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/drive-sync] knowledge phase failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Tell the team what landed in the company knowledge base. The project phase
  // notifies per project inside syncProjectFolders, where the project's name is
  // in hand; company documents have no record of their own, so it happens here.
  // Discriminated on `arrivals`, NOT on `skipped` — DriveSyncProgress has a
  // `skipped` COUNT of its own, so `'skipped' in knowledge` is true for both
  // arms and narrows to never.
  if ('arrivals' in knowledge && knowledge.arrivals.length) {
    await notifyArrivals(
      { label: 'the company knowledge base', href: '/company' },
      knowledge.arrivals
    )
  }

  // Deliberately after, and independently: a knowledge-folder problem must not
  // stop projects picking up the documents their teams just filed.
  let projectFolders
  try {
    projectFolders = await syncProjectFolders({
      budgetMs: Math.max(60_000, deadline - Date.now()),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/drive-sync] project folder phase failed:', message)
    projectFolders = {
      projects: 0,
      folders: 0,
      added: 0,
      updated: 0,
      superseded: 0,
      failed: 1,
      errors: [message.slice(0, 200)],
      outOfTime: false,
    }
  }

  /**
   * Phase 3 — the published index.
   *
   * No model call and no Drive reads beyond resolving folder ids, so it is
   * cheap; its own budget is small and it yields rather than overrunning. A
   * failure here must not colour the two phases that moved real documents, so
   * it is caught and reported, never thrown.
   */
  let trackers
  try {
    trackers = await publishAllTrackers({
      budgetMs: Math.max(30_000, deadline - Date.now()),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/drive-sync] tracker phase failed:', message)
    trackers = { published: [], skipped: [], outOfTime: false, error: message.slice(0, 200) }
  }

  const result = { knowledge, projectFolders, trackers }
  console.log('[cron/drive-sync]', JSON.stringify(result))
  return NextResponse.json(result)
}
