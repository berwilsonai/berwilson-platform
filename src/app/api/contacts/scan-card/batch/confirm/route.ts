/**
 * POST /api/contacts/scan-card/batch/confirm
 *
 * Body: { session_id, cards: [{ ref, action, ...edited fields }] }
 *
 * The only write path for a batch. Each row carries the reviewer's own
 * decision — create a contact, fill in the one already on file, or skip — and
 * their edits, which override whatever the model read off the card.
 *
 * One bad row never costs the reader the rest: each card is saved on its own
 * and a failure comes back named, with everything else already landed.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveCardContact, type CardAction } from '@/lib/contacts/card-save'
import { readCardBatch } from '@/lib/contacts/card-batch'
import type { CardScanDraft } from '@/lib/contacts/card-intake'
import type { Json } from '@/lib/supabase/types'

export const maxDuration = 300

interface CardDecision extends Partial<CardScanDraft> {
  ref?: string
  action?: CardAction
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    session_id?: string
    cards?: CardDecision[]
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId) return Response.json({ error: 'Missing session_id.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: session } = await admin
    .from('email_intake_sessions')
    .select('id, status, extraction_result, created_record_ids')
    .eq('id', sessionId)
    .eq('intake_kind', 'cards')
    .single()

  if (!session) return Response.json({ error: 'That batch no longer exists.' }, { status: 404 })
  if (session.status === 'confirmed') {
    return Response.json({ error: 'That batch has already been saved.' }, { status: 409 })
  }

  const staged = readCardBatch(session.extraction_result)
  if (!staged) return Response.json({ error: 'That batch has nothing to save.' }, { status: 400 })

  const decisions = (Array.isArray(body.cards) ? body.cards : []).filter(
    (c) => c.action === 'create' || c.action === 'link'
  )
  if (decisions.length === 0) {
    return Response.json({ error: 'No cards were selected to save.' }, { status: 400 })
  }

  const actor = await actorAdminClient()
  const partyIds: string[] = []
  const failures: Array<{ ref: string; name: string | null; error: string }> = []
  let created = 0
  let linked = 0

  for (const decision of decisions) {
    // The staged draft supplies everything the reviewer did not touch —
    // the summary, the fit read, the sources, the recognized text.
    const base = staged.items.find((i) => i.ref === decision.ref)?.draft ?? {}
    const merged = { ...base, ...decision } as Partial<CardScanDraft>
    try {
      const result = await saveCardContact(merged, decision.action as 'create' | 'link', actor)
      partyIds.push(result.id)
      if (result.action === 'created') created++
      else linked++
    } catch (err) {
      failures.push({
        ref: decision.ref ?? '?',
        name: merged.full_name ?? merged.company ?? null,
        error: err instanceof Error ? err.message : 'Could not save this contact.',
      })
    }
  }

  if (partyIds.length === 0) {
    return Response.json(
      { error: failures[0]?.error ?? 'Nothing could be saved.', failures },
      { status: 500 },
    )
  }

  const prior = (session.created_record_ids ?? {}) as { party_ids?: string[] }
  await admin
    .from('email_intake_sessions')
    .update({
      // A batch with a failed row stays open so the row can be retried; only a
      // clean sweep is confirmed and out of the queue.
      status: failures.length === 0 ? 'confirmed' : 'pending',
      confirmed_at: failures.length === 0 ? new Date().toISOString() : null,
      created_record_ids: {
        party_ids: [...new Set([...(prior.party_ids ?? []), ...partyIds])],
      } as unknown as Json,
    })
    .eq('id', sessionId)

  return Response.json({ created, linked, party_ids: partyIds, failures })
}
