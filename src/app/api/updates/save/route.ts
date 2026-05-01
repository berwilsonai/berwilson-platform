import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    project_id,
    raw_content,
    summary,
    action_items,
    waiting_on,
    risks,
    decisions,
    confidence,
  } = body

  if (!project_id || !raw_content) {
    return Response.json({ error: 'project_id and raw_content are required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'updates'> = {
    project_id,
    source: 'manual_paste',
    raw_content,
    summary: summary ?? null,
    action_items: action_items ?? [],
    waiting_on: waiting_on ?? [],
    risks: risks ?? [],
    decisions: decisions ?? [],
    confidence: typeof confidence === 'number' ? confidence : null,
    review_state: 'approved',
  }

  const { data, error } = await supabase.from('updates').insert(row).select('id').single()

  if (error) {
    console.error('Save update failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ id: data.id })
}
