import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Fields safe to patch inline from the detail page (e.g. status / priority pills).
const PATCHABLE = new Set([
  'status', 'priority', 'opp_type', 'probability', 'next_step', 'lead', 'estimated_value',
])

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'opportunities'> = {}
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
    .from('opportunities')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Refresh the searchable snapshot (skips pre-migration)
  embedOpportunitySnapshot(id).catch(console.error)

  return Response.json({ opportunity: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  // Remove attached files from storage (DB rows cascade on opportunity delete)
  const { data: docs } = await admin
    .from('opportunity_documents')
    .select('storage_path')
    .eq('opportunity_id', id)

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.storage_path)
    const { error: storageError } = await admin.storage.from('documents').remove(paths)
    if (storageError) console.error('Storage cleanup failed:', storageError.message)
  }

  const { error } = await admin.from('opportunities').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
