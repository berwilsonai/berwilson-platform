import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** PATCH — toggle a single action item's completed flag */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { index, completed } = body

  if (typeof index !== 'number' || index < 0 || typeof completed !== 'boolean') {
    return Response.json(
      { error: 'index (non-negative number) and completed (boolean) are required' },
      { status: 400 }
    )
  }

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

/** PUT — full edit of an update's extracted fields (summary, action_items, etc.) */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    summary?: string
    action_items?: unknown[]
    waiting_on?: unknown[]
    risks?: unknown[]
    decisions?: unknown[]
    project_id?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Build the update payload — only include fields that were sent
  const payload: {
    summary?: string
    action_items?: Json
    waiting_on?: Json
    risks?: Json
    decisions?: Json
    project_id?: string
  } = {}
  if (body.summary !== undefined) payload.summary = body.summary
  if (body.action_items !== undefined) payload.action_items = body.action_items as Json
  if (body.waiting_on !== undefined) payload.waiting_on = body.waiting_on as Json
  if (body.risks !== undefined) payload.risks = body.risks as Json
  if (body.decisions !== undefined) payload.decisions = body.decisions as Json
  if (body.project_id !== undefined) payload.project_id = body.project_id

  if (Object.keys(payload).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('updates')
    .update(payload)
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

/** GET — fetch a single update by ID */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('updates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return Response.json({ error: 'Update not found' }, { status: 404 })
  }

  return Response.json({ update: data })
}
