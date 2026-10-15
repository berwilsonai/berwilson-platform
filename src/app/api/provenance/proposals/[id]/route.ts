/**
 * PATCH /api/provenance/proposals/[id]
 *
 * Answer one of Pepper's questions about a guarded field.
 *
 * ⚠ THIS IS THE DOOR THAT DID NOT EXIST. `field_update_proposals` is where the
 * curator puts a change it refuses to make on its own — a guarded field (money,
 * ownership, a legally effective date) that a human already typed and the mail
 * now disagrees with. Three module headers describe reporting as the thing that
 * makes unattended writing safe, and until 2026-10-15 the table had no reader
 * and no writer outside the curator itself: every question accumulated as a
 * pending row with no screen, no note line and nowhere to answer it.
 *
 * `accept` applies the proposed value; `reject` records that the value on file
 * is right. Both are a human decision, which is the whole point — so both carry
 * THE READER as the actor, never Pepper and never "system" (§12: a
 * user-initiated mutation on a tracked table must name who did it).
 *
 * ⚠ THE UNTYPED CLIENT, WITH AN ACTOR. A proposal names its own table and
 * column at runtime, so the generated client cannot type the update —
 * `actorAdminClient()` refuses a string table name. `provDbAs` is the same
 * untyped client the curator writes through, taking the actor explicitly; the
 * safety here comes from `fieldSpec` below, which is the boundary, rather than
 * from the type.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { provDbAs } from '@/lib/provenance/db'
import { fieldSpec } from '@/lib/provenance/fields'
import { recordHumanWrite } from '@/lib/provenance/write'

const VERDICTS = ['accept', 'reject'] as const
type Verdict = (typeof VERDICTS)[number]

interface ProposalRow {
  id: string
  table_name: string
  record_id: string
  field_key: string
  record_label: string | null
  proposed_value: string | null
  current_value: string | null
  status: string
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let verdict: Verdict
  try {
    const body = (await request.json()) as { verdict?: string }
    if (!body.verdict || !VERDICTS.includes(body.verdict as Verdict)) {
      return NextResponse.json({ error: 'verdict must be accept or reject' }, { status: 400 })
    }
    verdict = body.verdict as Verdict
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The reader is the actor. Pepper raised the question; the person answers it.
  const db = provDbAs({ id: user.id, email: user.email })

  const { data, error } = await db
    .from('field_update_proposals')
    .select('id, table_name, record_id, field_key, record_label, proposed_value, current_value, status')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const row = data as unknown as ProposalRow
  // Already answered. Not an error — two taps from a flaky phone must settle
  // once rather than report a failure the second time.
  if (row.status !== 'pending') {
    return NextResponse.json({ ok: true, alreadyDecided: row.status })
  }

  let warning: string | null = null

  if (verdict === 'accept') {
    // ⚠ THE REGISTRY IS STILL THE BOUNDARY. A proposal row names its own table
    // and column, and this route must not become a way to write an arbitrary
    // column by posting a crafted id — the field whitelist is a security
    // boundary, not a convenience (§4, on the governance registers).
    const spec = fieldSpec(row.table_name, row.field_key)
    if (!spec) {
      return NextResponse.json(
        { error: `${row.table_name}.${row.field_key} is not a writable field` },
        { status: 400 }
      )
    }
    if (
      spec.allowedValues &&
      row.proposed_value !== null &&
      !spec.allowedValues.includes(row.proposed_value)
    ) {
      // §12: a value outside an enum fails the WHOLE query with 22P02 and a
      // NULL row set, discarding every other field in the same UPDATE.
      return NextResponse.json(
        { error: `"${row.proposed_value}" is not a permitted ${spec.label}` },
        { status: 400 }
      )
    }

    const { error: writeError } = await db
      .from(row.table_name)
      .update({ [row.field_key]: row.proposed_value })
      .eq('id', row.record_id)
    if (writeError) {
      return NextResponse.json({ error: writeError.message }, { status: 500 })
    }

    // ⚠ RECORDED AS A HUMAN WRITE, AND THIS IS ITS FIRST REAL CALLER.
    // `recordHumanWrite` had zero callers, so protection rested entirely on the
    // "unknown provenance reads as human" default. A value a person has now
    // explicitly approved must be marked as theirs, or the next pass sees
    // `written_by='pepper'` from the proposal's own evidence and treats the
    // field as hers to revise.
    const marked = await recordHumanWrite({
      table: row.table_name,
      recordId: row.record_id,
      fields: [row.field_key],
      actor: { id: user.id, email: user.email },
    })
    // Reported rather than swallowed: the value DID write, and a provenance
    // failure means the next pass will read the field as unowned and may
    // propose over it again. Saying so beats a silent 200.
    // ⚠ NOT AN EARLY RETURN. Returning here would leave the proposal `pending`
    // while its value was already written, so the question would be asked again
    // every morning about a field that now agrees with it. The warning rides
    // out with the response instead.
    if (marked.error) {
      warning = `The value was written but its provenance was not recorded: ${marked.error}`
    }
  }

  const { error: closeError } = await db
    .from('field_update_proposals')
    .update({
      status: verdict === 'accept' ? 'accepted' : 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    })
    .eq('id', id)
    // Claimed with the pending predicate still in the UPDATE, so two taps
    // settle once without a transaction.
    .eq('status', 'pending')
  if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    verdict,
    field: row.field_key,
    record: row.record_label,
    ...(warning ? { warning } : {}),
  })
}
