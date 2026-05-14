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
    .from('funding_sources')
    .select('*, contact_party:parties(id, full_name)')
    .eq('site_id', id)
    .order('created_at')

  if (error) {
    console.error('List funding sources failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ funding_sources: data })
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { source_name, category, ...fields } = body

  if (!source_name || !category) {
    return Response.json(
      { error: 'source_name and category are required' },
      { status: 400 }
    )
  }

  const row: TablesInsert<'funding_sources'> = {
    site_id: id,
    source_name: source_name.trim(),
    category,
    ...fields,
  }

  const { data, error } = await supabase
    .from('funding_sources')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create funding source failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ funding_source: data })
}
