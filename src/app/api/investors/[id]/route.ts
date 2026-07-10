import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Fields safe to patch inline from the detail page (stage pill, quick edits).
const PATCHABLE = new Set([
  'stage', 'interest_level', 'investor_type', 'next_step', 'next_step_date', 'last_contact_date',
])

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // /api/investors is not in any role allowlist (admin-only via middleware);
  // this check is defense-in-depth.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'investors'> = {}
  for (const [key, value] of Object.entries(body)) {
    if (PATCHABLE.has(key)) {
      // @ts-expect-error — key is constrained to PATCHABLE keys
      update[key] = value
    }
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No patchable fields provided' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('investors')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Refresh the searchable snapshot (skips pre-migration)
  embedInvestorSnapshot(id).catch(console.error)

  return Response.json({ investor: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can delete investors')

  const { id } = await params
  const admin = createAdminClient()

  // Investments and notes cascade; the linked directory contact stays.
  const { error } = await admin.from('investors').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
