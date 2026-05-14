import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data, error } = await supabase
    .from('stakeholder_relationships')
    .select('*, party:parties(id, full_name, company, title, email, phone)')
    .eq('site_id', id)
    .order('created_at')

  if (error) {
    console.error('List stakeholders failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ stakeholders: data })
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { party_id, ...fields } = body

  if (!party_id) {
    return Response.json({ error: 'party_id is required' }, { status: 400 })
  }

  const row: TablesInsert<'stakeholder_relationships'> = {
    site_id: id,
    party_id,
    role: fields.role || null,
    temperature: fields.temperature || null,
    next_scheduled: fields.next_scheduled || null,
    notes: fields.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('stakeholder_relationships')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create stakeholder failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ stakeholder: data })
}
