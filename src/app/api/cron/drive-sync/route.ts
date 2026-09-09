import { NextRequest, NextResponse } from 'next/server'
import { syncDriveKnowledge } from '@/lib/knowledge/drive-sync'
import { syncProjectFolders } from '@/lib/drive/project-folder-sync'
import { isDriveConfigured } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/drive-sync
 *
 * Two phases, both reading Drive:
 *   1. Index the nominated knowledge folder into the company knowledge base,
 *      which is what the fit assessor cites as evidence.
 *   2. Re-import every project's linked Drive folder, so documents the team
 *      files in Drive reach the project instead of only living there — and post
 *      one update per project saying what arrived and what it is about.
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

  const result = { knowledge, projectFolders }
  console.log('[cron/drive-sync]', JSON.stringify(result))
  return NextResponse.json(result)
}
