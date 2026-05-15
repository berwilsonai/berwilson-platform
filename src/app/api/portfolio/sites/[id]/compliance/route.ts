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
    .from('compliance_items')
    .select('*')
    .eq('site_id', id)
    .order('framework')
    .order('created_at')

  if (error) {
    console.error('List compliance items failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ compliance_items: data })
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { framework, requirement, ...fields } = body

  if (!framework || !requirement) {
    return Response.json({ error: 'framework and requirement are required' }, { status: 400 })
  }

  const row: TablesInsert<'compliance_items'> = {
    site_id: id,
    framework: framework.trim(),
    requirement: requirement.trim(),
    status: fields.status || null,
    due_date: fields.due_date || null,
    notes: fields.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('compliance_items')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create compliance item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ compliance_item: data })
}
