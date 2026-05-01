import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

const ALLOWED_FIELDS = [
  'full_name',
  'company',
  'title',
  'email',
  'phone',
  'relationship_notes',
  'linkedin_url',
  'avatar_url',
  'is_organization',
] as const

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()

  // Only allow known fields
  const updates: TablesUpdate<'parties'> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) {
      ;(updates as Record<string, unknown>)[key] = body[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('parties')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ party: data })
}
