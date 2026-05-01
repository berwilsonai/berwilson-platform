import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { project_id, category, item, severity, status, assigned_to, notes } = body

  if (!project_id || !category || !item) {
    return Response.json(
      { error: 'project_id, category, and item are required' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'dd_items'> = {
    project_id,
    category,
    item: item.trim(),
    severity: severity ?? 'info',
    status: status ?? 'open',
    assigned_to: assigned_to || null,
    notes: notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('dd_items')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Add dd_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ dd_item: data })
}
