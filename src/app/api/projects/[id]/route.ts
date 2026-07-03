import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Inline quick-edit of capture fields (bid due date, P-win, bid decision)
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !(await canAccessProject(viewer, id))) return forbiddenJson()

  const body = await request.json().catch(() => ({}))

  const update: TablesUpdate<'projects'> = {}

  if ('bid_due_date' in body) {
    const v = body.bid_due_date
    update.bid_due_date = v ? String(v) : null
  }

  if ('win_probability' in body) {
    const v = body.win_probability
    if (v === null || v === '') {
      update.win_probability = null
    } else {
      const n = Math.round(Number(v))
      if (isNaN(n) || n < 0 || n > 100) {
        return Response.json({ error: 'win_probability must be 0–100' }, { status: 400 })
      }
      update.win_probability = n
    }
  }

  if ('bid_decision' in body) {
    const v = body.bid_decision
    if (v !== 'undecided' && v !== 'pursue' && v !== 'no_bid') {
      return Response.json({ error: 'invalid bid_decision' }, { status: 400 })
    }
    update.bid_decision = v
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'no editable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('projects')
    .update(update)
    .eq('id', id)
    .select('id, bid_due_date, win_probability, bid_decision')
    .single()

  if (error) {
    console.error('Quick-edit failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ project: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can delete projects')
  const supabase = await actorAdminClient()

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
