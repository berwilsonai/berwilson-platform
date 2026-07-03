import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'

// Small rotating palette for new member avatars
const PALETTE = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange']

/** GET — list active team members */
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, color, active, created_at')
    .eq('active', true)
    .order('created_at', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ members: data })
}

/** POST — quick-add a new team member by name */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && viewer.role !== 'executive')) {
    return forbiddenJson('Only admins can add team members')
  }

  const body = await request.json()
  const { name } = body
  if (!name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Pick the next palette color based on current count
  const { count } = await supabase
    .from('team_members')
    .select('*', { count: 'exact', head: true })
  const color = PALETTE[(count ?? 0) % PALETTE.length]

  const row: TablesInsert<'team_members'> = { name: name.trim(), color }
  const { data, error } = await supabase.from('team_members').insert(row).select('*').single()

  if (error) {
    console.error('Add team member failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ member: data })
}
