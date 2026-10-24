/**
 * POST /api/jobs — give the working assistant a task.
 * GET  /api/jobs — the queue and recent history.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { claimNextJob, runClaimedJob } from '@/lib/jobs/queue'

export const maxDuration = 3600

const MAX_INSTRUCTION = 20_000

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 50, 200)
  const { data, error } = await createAdminClient()
    .from('jobs')
    .select('id, title, instruction, status, queued_at, started_at, finished_at, heartbeat_at, rounds, operations, applied_at, error')
    .order('queued_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''

  if (!instruction) {
    return NextResponse.json({ error: 'Say what the job is.' }, { status: 400 })
  }
  if (instruction.length > MAX_INSTRUCTION) {
    return NextResponse.json(
      { error: `That instruction is ${instruction.length} characters; ${MAX_INSTRUCTION} is the most one job carries.` },
      { status: 400 }
    )
  }

  const db = createAdminClient()
  const { data: job, error } = await db
    .from('jobs')
    .insert({
      created_by: user.id,
      instruction,
      // First line of the instruction, until the UI lets a title be typed.
      title: title || instruction.split('\n')[0].slice(0, 120),
      status: 'queued',
    })
    .select('id')
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Could not queue the job.' }, { status: 500 })
  }

  // ⚠ KICKED, NOT RUN. Not awaited, so the browser gets the id at once and the
  // work starts in seconds rather than waiting up to a minute for the launchd
  // tick. This process may be killed mid-job by a deploy — `npm run build` IS
  // the deploy (§12) — which is exactly why the job's progress is checkpointed
  // after every round and a stale `working` row is reclaimed on the heartbeat
  // clock by the same cron. The kick is an optimisation; the cron is the
  // guarantee.
  //
  // Calling `claimNextJob` here rather than fetching our own cron route is
  // deliberate: §12 — never reach for the app's own HTTP endpoints from inside
  // it, extract the shared logic into `src/lib` instead. This IS that logic.
  void (async () => {
    try {
      const claimed = await claimNextJob(db)
      if (claimed) await runClaimedJob(db, claimed)
    } catch (err) {
      console.error('[jobs] kick failed; the cron will pick it up:', err)
    }
  })()

  return NextResponse.json({ id: job.id })
}
