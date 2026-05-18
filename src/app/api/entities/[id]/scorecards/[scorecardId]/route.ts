import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

// PATCH /api/entities/[id]/scorecards/[scorecardId] — update a scorecard
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scorecardId: string }> }
) {
  const { id, scorecardId } = await params
  const body = await req.json()
  const supabase = createAdminClient() as unknown as SupabaseClient

  const { data, error } = await supabase
    .from('federal_scorecards')
    .update(body)
    .eq('id', scorecardId)
    .eq('entity_id', id)
    .select('*, projects(id, name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ scorecard: data })
}

// DELETE /api/entities/[id]/scorecards/[scorecardId] — delete a scorecard
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; scorecardId: string }> }
) {
  const { id, scorecardId } = await params
  const supabase = createAdminClient() as unknown as SupabaseClient

  const { error } = await supabase
    .from('federal_scorecards')
    .delete()
    .eq('id', scorecardId)
    .eq('entity_id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
