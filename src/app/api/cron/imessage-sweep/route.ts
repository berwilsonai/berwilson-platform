import { NextRequest, NextResponse } from 'next/server'
import { runIMessageSweep } from '@/lib/imessage/sweep'
import { deferredResponse, interactiveRunInFlight } from '@/lib/ai/run-state'

/**
 * GET /api/cron/imessage-sweep
 *
 * Reads the local Messages snapshot, classifies each conversation, and writes
 * the business ones as `email_threads` rows. It creates no records: the mail
 * sweep's own phases then summarize, cluster, route and extract commitments
 * from them on its next hourly run, and anything that would become a project,
 * party or task still waits for a human on /decide (§11).
 *
 * Runs on com.berwilson.cron-imessage-sweep, which runs `bw-snapshot` first.
 *
 * ⚠ A STALE SNAPSHOT IS REPORTED, NOT SKIPPED. If `bw-snapshot` has lost Full
 * Disk Access — which a macOS update can do — the file it left behind is still
 * perfectly readable and simply stops changing. The sweep then finds no new
 * sessions and reports a quiet week, which is indistinguishable from a quiet
 * week. §12: a liveness check needs a clock, not a count.
 */
export const maxDuration = 1800

/** Older than this and the snapshot is not evidence of anything. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000

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
    return NextResponse.json(deferredResponse('imessage-sweep', waitingOnAnswer))
  }


  const days = Number(request.nextUrl.searchParams.get('days')) || undefined
  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true'

  try {
    const { statSync } = await import('node:fs')
    const { snapshotDbPath } = await import('@/lib/imessage/read')
    const path = snapshotDbPath()

    let ageMs: number | null = null
    try {
      ageMs = Date.now() - statSync(path).mtimeMs
    } catch {
      return NextResponse.json(
        {
          error: `No Messages snapshot at ${path}. Build and grant bw-snapshot: zsh scripts/build-snapshot.sh`,
        },
        { status: 503 }
      )
    }

    const result = await runIMessageSweep({ days, dryRun })
    const stale = ageMs > STALE_AFTER_MS
    const payload = {
      ...result,
      snapshotAgeMinutes: Math.round(ageMs / 60000),
      stale,
    }
    console.log('[cron/imessage-sweep]', JSON.stringify(payload))

    // Loud, because the symptom of the failure is silence.
    if (stale) {
      return NextResponse.json(
        {
          ...payload,
          error: `Snapshot is ${Math.round(ageMs / 3600000)}h old — bw-snapshot is not running or has lost Full Disk Access.`,
        },
        { status: 503 }
      )
    }
    if (!result.ok) return NextResponse.json(payload, { status: 503 })
    return NextResponse.json(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/imessage-sweep] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
