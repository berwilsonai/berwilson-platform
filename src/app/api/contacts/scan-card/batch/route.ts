/**
 * POST /api/contacts/scan-card/batch
 *
 * Body: { cards: [{ raw_text, file_name? }], label? }  → start a stack
 *       { session_id }                                 → resume an unfinished one
 *
 * Returns as soon as the session row exists. The stack is then read in the
 * background, one card at a time, with the session written back after each —
 * so the page can leave, the phone can sleep, and the reader comes back to a
 * finished review. Creates NOTHING; the human confirms at ./confirm.
 *
 * Resuming matters more than it looks. A deploy is a `launchctl kickstart`, and
 * a kickstart mid-batch kills the background pass wherever it had got to. The
 * recognized text is on the session, so resuming re-reads only the cards that
 * never finished and costs nobody a second photograph.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  emptyCardBatch,
  processCardBatch,
  readCardBatch,
  MAX_CARDS_PER_BATCH,
} from '@/lib/contacts/card-batch'
import type { Json } from '@/lib/supabase/types'

// The handler itself returns in milliseconds; the work outlives it.
export const maxDuration = 60

interface BatchBody {
  cards?: Array<{ raw_text?: unknown; file_name?: unknown }>
  label?: unknown
  session_id?: unknown
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as BatchBody
  const admin = createAdminClient()

  // ── Resume ────────────────────────────────────────────────────────────────
  const resumeId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (resumeId) {
    const { data: session } = await admin
      .from('email_intake_sessions')
      .select('id, status, extraction_result')
      .eq('id', resumeId)
      .eq('intake_kind', 'cards')
      .single()

    if (!session) return Response.json({ error: 'That batch no longer exists.' }, { status: 404 })
    if (session.status === 'confirmed') {
      return Response.json({ error: 'That batch has already been saved.' }, { status: 409 })
    }

    const draft = readCardBatch(session.extraction_result)
    const remaining = (draft?.items ?? []).filter((i) => i.state !== 'ready').length
    if (!draft || remaining === 0) {
      return Response.json({ error: 'Every card in that batch has already been read.' }, { status: 409 })
    }

    // Clear a previous run's error before re-entering, so a resumed batch does
    // not still read as failed while it is working.
    await admin
      .from('email_intake_sessions')
      .update({
        status: 'running',
        extraction_result: { ...draft, error: undefined } as unknown as Json,
      })
      .eq('id', resumeId)

    void processCardBatch(resumeId, user.id)
    return Response.json({ session_id: resumeId, cards: remaining, resumed: true })
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  const cards = (Array.isArray(body.cards) ? body.cards : [])
    .map((c) => ({
      raw_text: typeof c?.raw_text === 'string' ? c.raw_text.trim() : '',
      file_name: typeof c?.file_name === 'string' ? c.file_name : null,
    }))
    .filter((c) => c.raw_text.length >= 5)

  if (cards.length === 0) {
    return Response.json(
      { error: 'No readable card text was submitted. Scan the photos first.' },
      { status: 400 },
    )
  }
  if (cards.length > MAX_CARDS_PER_BATCH) {
    return Response.json(
      {
        error: `That is ${cards.length} cards — ${MAX_CARDS_PER_BATCH} is the most one batch will read, because each one is a separate pass over the local model. Split it into two.`,
      },
      { status: 400 },
    )
  }

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const draft = emptyCardBatch(cards)

  const { data: staged, error: stageErr } = await admin
    .from('email_intake_sessions')
    .insert({
      user_id: user.id,
      intake_kind: 'cards',
      status: 'running',
      label: label || `${cards.length} business card${cards.length === 1 ? '' : 's'}`,
      // The recognized text, kept whole: it is what a resume re-reads, and what
      // a reviewer checks a bad parse against. The photographs are already gone.
      raw_text: cards.map((c) => c.raw_text).join('\n\n--- card ---\n\n'),
      extraction_result: draft as unknown as Json,
    })
    .select('id')
    .single()

  if (stageErr || !staged) {
    console.error('[card-batch] could not stage session:', stageErr)
    return Response.json({ error: 'Could not start the batch. Try again shortly.' }, { status: 500 })
  }

  // Deliberately not awaited: the reader should not hold a connection open for
  // the twenty minutes a full stack takes. Progress lands on the session row.
  void processCardBatch(staged.id, user.id)

  return Response.json({ session_id: staged.id, cards: cards.length })
}
