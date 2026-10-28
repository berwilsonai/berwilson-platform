import { NextResponse, type NextRequest } from 'next/server'

import { writeSnapshot } from '@/lib/records/snapshot'

/**
 * GET /api/cron/portfolio-snapshot
 *
 * One row a week of the dashboard's own KPI figures, so a tile can say which
 * way the number is going. Driven by a launchd job
 * (com.berwilson.cron-portfolio-snapshot), Mondays at 05:30 — before the
 * 06:20 curator and the 06:45 reminder, so the week's figures are the ones a
 * human is about to be shown.
 *
 * ⚠ IT IS SAFE TO RUN AT ANY TIME, AND MORE THAN ONCE. The row upserts on
 * `captured_on`, so a deploy, a manual curl or a launchd catch-up after the
 * box slept cannot write two rows for one day and double that week's delta.
 *
 * ⚠ NO MODEL CALL, SO IT DOES NOT QUEUE BEHIND ANYTHING. LM Studio serves one
 * request at a time (§12) and eight sweeps already contend for it; this is
 * five aggregate reads and one insert, and it deliberately stays that way —
 * nothing here needs judgement.
 *
 * ⚠ CONFIDENTIAL PROJECTS NEVER REACH A ROW. The exclusion is in
 * `computeSnapshot`, at write time, because a stored total cannot be filtered
 * afterwards (§8).
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (fail closed if the secret is not configured)
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const snapshot = await writeSnapshot()
    return NextResponse.json({ ok: true, snapshot })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to write the portfolio snapshot'
    console.error('[portfolio-snapshot]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
