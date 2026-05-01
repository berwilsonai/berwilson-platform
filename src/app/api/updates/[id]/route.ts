import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const { index, completed } = body

  if (typeof index !== 'number' || index < 0 || typeof completed !== 'boolean') {
    return Response.json(
      { error: 'index (non-negative number) and completed (boolean) are required' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  // Fetch current action_items
  const { data: update, error: fetchError } = await supabase
    .from('updates')
    .select('action_items')
    .eq('id', id)
    .single()

  if (fetchError || !update) {
    return Response.json({ error: 'Update not found' }, { status: 404 })
  }

  const items: Record<string, unknown>[] = Array.isArray(update.action_items)
    ? (update.action_items as Record<string, unknown>[]).map(item => ({ ...item }))
    : []

  if (index >= items.length) {
    return Response.json({ error: 'Index out of bounds' }, { status: 400 })
  }

  // Toggle the completed field on the target item
  items[index] = { ...items[index], completed }

  const { error: updateError } = await supabase
    .from('updates')
    .update({ action_items: items as unknown as Json })
    .eq('id', id)

  if (updateError) {
    return Response.json({ error: 'Failed to update action item' }, { status: 500 })
  }

  return Response.json({ action_items: items })
}
