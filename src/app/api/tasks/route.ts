import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert, Json } from '@/lib/supabase/types'

/** POST — create a manual task by inserting a lightweight update with a single action_item */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { project_id, text, assignee, due_date } = body

  if (!project_id || !text?.trim()) {
    return Response.json({ error: 'project_id and text are required' }, { status: 400 })
  }

  const actionItem = {
    text: text.trim(),
    assignee: assignee?.trim() || null,
    due_date: due_date || null,
    completed: false,
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'updates'> = {
    project_id,
    source: 'manual_task',
    raw_content: text.trim(),
    summary: null,
    action_items: [actionItem],
    waiting_on: [],
    risks: [],
    decisions: [],
    confidence: null,
    review_state: 'approved',
  }

  const { data, error } = await supabase.from('updates').insert(row).select('id').single()

  if (error) {
    console.error('Create task failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ id: data.id, task: actionItem })
}

/** DELETE — remove a single action_item from an update.
 *  If it's the only item, delete the entire update row. */
export async function DELETE(request: NextRequest) {
  const body = await request.json()
  const { update_id, index } = body

  if (!update_id || typeof index !== 'number' || index < 0) {
    return Response.json({ error: 'update_id and index (non-negative number) are required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: update, error: fetchError } = await supabase
    .from('updates')
    .select('action_items')
    .eq('id', update_id)
    .single()

  if (fetchError || !update) {
    return Response.json({ error: 'Update not found' }, { status: 404 })
  }

  const items: Record<string, unknown>[] = Array.isArray(update.action_items)
    ? (update.action_items as Record<string, unknown>[])
    : []

  if (index >= items.length) {
    return Response.json({ error: 'Index out of bounds' }, { status: 400 })
  }

  // If only one action_item, delete the entire update row
  if (items.length === 1) {
    const { error } = await supabase.from('updates').delete().eq('id', update_id)
    if (error) {
      return Response.json({ error: 'Failed to delete task' }, { status: 500 })
    }
    return Response.json({ deleted: 'update' })
  }

  // Otherwise, splice out the item and update
  const newItems = items.filter((_, i) => i !== index)
  const { error: updateError } = await supabase
    .from('updates')
    .update({ action_items: newItems as unknown as Json })
    .eq('id', update_id)

  if (updateError) {
    return Response.json({ error: 'Failed to remove task' }, { status: 500 })
  }

  return Response.json({ deleted: 'item', action_items: newItems })
}
