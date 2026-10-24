/**
 * POST /api/jobs/[id]/apply — apply the operations the reviewer ticked.
 *
 * ⚠ `selected` IS REQUIRED AND AN EMPTY ARRAY MEANS NOTHING HAPPENS. A missing
 * selection must not mean "all of them": the §12 rule is that a security
 * decision defaults to the SAFE answer, and a malformed body that applies 232
 * writes is the shape of that bug.
 *
 * ⚠ THE ACTOR CLIENT, NOT THE PLAIN ADMIN ONE. These are user-initiated
 * mutations on tracked tables, and a trail whose every row reads "system"
 * answers nothing — which is the only question the activity log was added to
 * answer (§12).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { actorAdminClient } from '@/lib/auth/viewer'
import { applyJobOperations } from '@/lib/jobs/apply'
import { validateOperations } from '@/lib/jobs/operations'
import type { JsonIn } from '@/lib/supabase/types'

export const maxDuration = 600

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (!Array.isArray(body.selected)) {
    return NextResponse.json({ error: 'Say which operations to apply.' }, { status: 400 })
  }
  const selected = body.selected
    .map((n: unknown) => Number(n))
    .filter((n: number) => Number.isInteger(n) && n >= 0)

  const admin = createAdminClient()
  const { data: job, error: readErr } = await admin
    .from('jobs')
    .select('id, status, operations, applied_at')
    .eq('id', id)
    .maybeSingle()

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 })
  if (job.applied_at) {
    return NextResponse.json({ error: 'This job has already been applied.' }, { status: 409 })
  }
  if (job.status !== 'review') {
    return NextResponse.json(
      { error: `This job is ${job.status} — only a job waiting for review can be applied.` },
      { status: 409 }
    )
  }

  // ⚠ RE-VALIDATED AT THE WRITE, not trusted from the column. The row is jsonb
  // and may have been written by an older version of the vocabulary; a verb
  // retired since the job ran must not execute because it was legal then.
  const { operations, rejected } = validateOperations(job.operations)
  if (selected.length === 0) {
    return NextResponse.json({ applied: 0, proposed: 0, skipped: 0, failed: 0, outcomes: [], rejected })
  }

  // Latch first: `applying` stops a second press racing the first.
  const { data: latched } = await admin
    .from('jobs')
    .update({ status: 'applying' })
    .eq('id', id)
    .eq('status', 'review')
    .select('id')
    .maybeSingle()
  if (!latched) {
    return NextResponse.json({ error: 'Another apply is already running for this job.' }, { status: 409 })
  }

  const db = await actorAdminClient()
  try {
    const result = await applyJobOperations({
      db,
      operations,
      selected,
      actorLabel: user.email ?? 'Ber Wilson',
      jobId: id,
    })

    await admin
      .from('jobs')
      .update({
        status: 'done',
        applied_at: new Date().toISOString(),
        applied_by: user.id,
        applied_result: { ...result, rejected } as unknown as JsonIn,
      })
      .eq('id', id)

    return NextResponse.json({ ...result, rejected })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Back to `review` rather than stuck in `applying`: the operations are
    // still there and the reviewer can try again.
    await admin.from('jobs').update({ status: 'review', error: message.slice(0, 4000) }).eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
