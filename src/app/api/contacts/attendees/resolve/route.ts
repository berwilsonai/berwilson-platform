import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import {
  createContactFromRecording,
  linkAttendeeName,
  skipAttendeeName,
} from '@/lib/contacts/attendee-resolve'

/**
 * One row of the findings queue, decided.
 *
 * Three verbs, because the queue offers three answers and a classification
 * decides which of them a row may even be given (`offeredActions` in
 * `attendee-findings.ts`):
 *
 *   `create` — make the contact, then link every slot carrying that name.
 *   `link`   — point every slot at a contact that already exists.
 *   `skip`   — record that the name is not a contact, with the reason.
 *
 * ⚠ THE CLASSIFICATION IS RE-DERIVED SERVER-SIDE FOR `create`, NOT TRUSTED FROM
 * THE CLIENT. The refusal lives in `createContactFromRecording`: a one-word
 * person is rejected there, so a crafted or stale request cannot put "Mike" in
 * the directory even though the button for it is never rendered. §12 — a
 * security or integrity rule held only in component state is not a rule.
 *
 * ⚠ `actorAdminClient()`, because `parties` and `party_notes` both carry
 * `log_activity()` and a trail whose every row reads "system" answers nothing.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const supabase = await actorAdminClient()
  // The viewer's own answer, so a protected project's meetings are left
  // untouched by a stamp as well as hidden from the queue that offered it.
  const hidden = await viewerHiddenProjectIds()

  if (action === 'skip') {
    const reason = typeof body.reason === 'string' ? body.reason : 'declined'
    const allowed = ['organization', 'internal', 'not_a_person', 'declined'] as const
    // ⚠ CHECKED AGAINST THE CHECK CONSTRAINT'S MEMBERS BEFORE THE WRITE. §12: a
    // value outside an enum fails the WHOLE query and returns 22P02 with a NULL
    // row set, so one plausible-but-wrong value would discard the write and
    // report a 500 for what is really a bad request.
    if (!(allowed as readonly string[]).includes(reason)) {
      return NextResponse.json(
        { error: `reason must be one of ${allowed.join(', ')}` },
        { status: 400 },
      )
    }
    const note = typeof body.note === 'string' ? body.note.trim() || null : null
    const result = await skipAttendeeName(
      supabase,
      name,
      reason as (typeof allowed)[number],
      note,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'skip' })
  }

  if (action === 'link') {
    const partyId = typeof body.party_id === 'string' ? body.party_id : ''
    if (!partyId) return NextResponse.json({ error: 'party_id is required' }, { status: 400 })
    const { data: party } = await supabase
      .from('parties')
      .select('id, full_name')
      .eq('id', partyId)
      .maybeSingle()
    if (!party) return NextResponse.json({ error: 'That contact no longer exists' }, { status: 404 })

    const stamp = await linkAttendeeName(supabase, partyId, { name, hidden })
    return NextResponse.json({
      ok: true,
      action: 'link',
      party_id: partyId,
      party_name: party.full_name,
      ...stamp,
    })
  }

  if (action === 'create') {
    const fullName = typeof body.full_name === 'string' && body.full_name.trim()
      ? body.full_name.trim()
      : name
    const result = await createContactFromRecording(supabase, {
      name,
      hidden,
      fullName,
      role: typeof body.role === 'string' ? body.role.trim() || null : null,
      company: typeof body.company === 'string' ? body.company.trim() || null : null,
      email: typeof body.email === 'string' ? body.email.trim() || null : null,
      isOrganization: body.is_organization === true,
    })
    if (result.error || !result.partyId) {
      // 400, not 500: every refusal this can produce is about what was asked
      // for — a one-word name, or a name two contacts already answer to — and a
      // reader needs to be told which rather than shown a failure.
      return NextResponse.json({ error: result.error ?? 'could not create the contact' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      action: 'create',
      party_id: result.partyId,
      party_name: fullName,
      ...(result.stamp ?? {}),
    })
  }

  return NextResponse.json({ error: 'action must be create, link or skip' }, { status: 400 })
}
