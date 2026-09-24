/**
 * POST /api/contacts/profile-intake/run
 *
 * Body: { input: string, sinceDays?: number, skipWeb?: boolean, label?: string }
 *
 * Reads the mail for everyone named in `input` and stages ONE pending review
 * session. Creates nothing — the human confirms at
 * /api/contacts/profile-intake/confirm.
 *
 * A `running` session row is staged immediately so the run stays visible if the
 * browser leaves, and flips to `pending` on success or `failed` (carrying the
 * error) on any failure path — the same contract as the Email Research run,
 * because the reason is the same: a cast of five is five local-model calls and
 * nobody should have to sit and watch them.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseSeeds, buildProfileDrafts } from '@/lib/contacts/profile-intake'
import type { Json } from '@/lib/supabase/types'

export const maxDuration = 300

/** Cap the cast so one paste cannot queue an hour of model time. */
const MAX_SEEDS = 12

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const input = typeof body.input === 'string' ? body.input.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const sinceDays = Number(body.sinceDays) > 0 ? Number(body.sinceDays) : 3650
  const skipWeb = body.skipWeb === true

  if (!input) {
    return Response.json({ error: 'Enter at least one name or email address.' }, { status: 400 })
  }

  const seeds = parseSeeds(input)
  if (seeds.length === 0) {
    return Response.json(
      { error: 'Nothing in that looked like a name or an email address.' },
      { status: 400 }
    )
  }
  if (seeds.length > MAX_SEEDS) {
    return Response.json(
      {
        error: `That is ${seeds.length} people — ${MAX_SEEDS} is the most one run will read, because each one is a separate pass over their mail. Split it into two runs.`,
      },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const defaultLabel =
    seeds.length === 1
      ? seeds[0].name ?? seeds[0].email ?? 'People'
      : `${seeds[0].name ?? seeds[0].email} + ${seeds.length - 1} more`

  const { data: staged, error: stageErr } = await admin
    .from('email_intake_sessions')
    .insert({
      user_id: user.id,
      intake_kind: 'people',
      status: 'running',
      label: label || defaultLabel,
      raw_text: input,
      extraction_result: {} as never,
    })
    .select('id')
    .single()

  if (stageErr || !staged) {
    console.error('[people-intake] could not stage session:', stageErr)
    return Response.json({ error: 'Could not start the run. Try again shortly.' }, { status: 500 })
  }
  const sessionId = staged.id

  try {
    const draft = await buildProfileDrafts({ seeds, userId: user.id, sinceDays, skipWeb })

    const { error: saveErr } = await admin
      .from('email_intake_sessions')
      .update({
        status: 'pending',
        extraction_result: draft as unknown as Json,
      })
      .eq('id', sessionId)
    if (saveErr) throw new Error(saveErr.message)

    return Response.json({
      session_id: sessionId,
      people: draft.people.length,
      cast: draft.cast.length,
      threads_read: draft.stats.threads_read,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The run failed unexpectedly.'
    console.error('[people-intake] run failed:', err)
    await admin
      .from('email_intake_sessions')
      .update({ status: 'failed', extraction_result: { error: message } as never })
      .eq('id', sessionId)
    return Response.json({ error: message }, { status: 500 })
  }
}
