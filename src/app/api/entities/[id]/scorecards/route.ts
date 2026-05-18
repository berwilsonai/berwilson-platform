import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

// GET /api/entities/[id]/scorecards — list all federal scorecards for an entity
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createAdminClient() as unknown as SupabaseClient

  const { data, error } = await supabase
    .from('federal_scorecards')
    .select('*, projects(id, name)')
    .eq('entity_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ scorecards: data })
}

// POST /api/entities/[id]/scorecards — create a new federal scorecard
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const supabase = createAdminClient() as unknown as SupabaseClient

  const { data, error } = await supabase
    .from('federal_scorecards')
    .insert({
      entity_id: id,
      ...body,
    })
    .select('*, projects(id, name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ scorecard: data })
}
