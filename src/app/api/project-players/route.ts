import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    project_id: string
    party_id: string
    role: string
    is_primary?: boolean
    notes?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.project_id || !body.party_id || !body.role?.trim()) {
    return NextResponse.json(
      { error: 'project_id, party_id, and role are required' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('project_players')
    .insert({
      project_id: body.project_id,
      party_id: body.party_id,
      role: body.role.trim(),
      is_primary: body.is_primary ?? false,
      notes: body.notes ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
