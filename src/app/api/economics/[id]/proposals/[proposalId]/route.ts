/**
 * PATCH /api/economics/[id]/proposals/[proposalId] — accept or reject.
 *
 * ⚠ ACCEPTING IS WHAT WRITES THE NUMBER, AND IT WRITES THE PROVENANCE WITH IT.
 * The figure and the sentence it came from land together, so an accepted value
 * can always be traced back to the document that said it. A value without its
 * source would be exactly the unlabelled figure this whole feature replaces.
 *
 * ⚠ AND A DECIDED PROPOSAL IS NEVER RE-DECIDED. The read filters on
 * `status = 'pending'`, so a second accept 404s rather than inserting a
 * duplicate line. The same contract `commitments` holds: a machine may move a
 * row between its own states and must never overwrite a human's.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import { calcDb, calcDbAs, num, type InputProposalRow } from '@/lib/economics/db'
import { explainEconomicsError } from '@/lib/economics/collections'
import { lineInsert } from '@/lib/economics/store'

type Params = { params: Promise<{ id: string; proposalId: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, proposalId } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const decision = body.decision
  if (decision !== 'accepted' && decision !== 'rejected') {
    return Response.json({ error: 'A decision is "accepted" or "rejected"' }, { status: 400 })
  }

  const actor = actorFrom(access.viewer)
  const db = calcDbAs(actor)

  const { data: existing, error: readError } = await calcDb()
    .from('economics_input_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('economics_id', id)
    .eq('status', 'pending')
    .maybeSingle()
  if (readError) return Response.json({ error: readError.message }, { status: 400 })
  if (!existing) {
    return Response.json({ error: 'Not found, or already decided' }, { status: 404 })
  }
  const proposal = existing as InputProposalRow

  const who = actor.name ?? actor.email ?? 'a reader'
  const decided = {
    status: decision,
    decided_by: who,
    decided_at: new Date().toISOString(),
  }

  if (decision === 'rejected') {
    const { error } = await db
      .from('economics_input_proposals')
      .update(decided)
      .eq('id', proposalId)
    if (error) return Response.json({ error: error.message }, { status: 400 })
    // Kept rather than deleted: a rejected proposal is the record of a question
    // that was asked and answered, and deleting it invites the same figure
    // being proposed again on the next pass.
    return Response.json({ status: 'rejected' })
  }

  const value = num(proposal.proposed_value)
  if (value == null) {
    return Response.json({ error: 'This proposal carries no figure to accept' }, { status: 400 })
  }

  try {
    let lineId = proposal.line_id

    if (lineId == null) {
      if (!proposal.proposed_line_type) {
        return Response.json(
          { error: 'This proposal names no line type, so there is nowhere to put the figure' },
          { status: 400 }
        )
      }
      // A new line carrying just this figure. Deliberately NOT our revenue by
      // default: on these deals most of the gross is a partner's, and assuming
      // otherwise is the error that makes a deal look three times its size.
      const row = lineInsert(
        id,
        proposal.proposed_line_type,
        proposal.proposed_label ?? 'From a document',
        {
          [proposal.field_key]: value,
          // The basis the model read out of the document, which the extraction
          // has already clamped to a real provenance level.
          status: 'planning_assumption',
          notes: proposal.source_quote,
        }
      )
      const { data: line, error } = await db
        .from('economics_lines')
        .insert(row)
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      lineId = (line as { id: string }).id
    } else {
      const { error } = await db
        .from('economics_lines')
        .update({ [proposal.field_key]: value })
        .eq('id', lineId)
        .eq('economics_id', id)
      if (error) throw new Error(error.message)
    }

    // The figure and its source land together. `onConflict` on the natural key
    // so re-sourcing a field replaces the citation rather than stacking one.
    const { error: provError } = await db.from('economics_provenance').upsert(
      {
        economics_id: id,
        line_id: lineId,
        field_key: proposal.field_key,
        status: 'planning_assumption',
        source: proposal.source_quote
          ? `Read from a document and accepted by ${who}`
          : `Accepted by ${who}`,
        source_ref: proposal.source_document_id,
        as_of: new Date().toISOString().slice(0, 10),
        note: proposal.source_quote,
      },
      { onConflict: 'economics_id,line_id,field_key' }
    )
    if (provError) throw new Error(provError.message)

    const { error: closeError } = await db
      .from('economics_input_proposals')
      .update({ ...decided, line_id: lineId })
      .eq('id', proposalId)
    if (closeError) throw new Error(closeError.message)

    return Response.json({ status: 'accepted', line_id: lineId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[economics] accepting a proposal failed:', message)
    return Response.json({ error: explainEconomicsError(message) }, { status: 500 })
  }
}
