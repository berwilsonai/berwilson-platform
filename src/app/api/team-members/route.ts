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

/**
 * Find-or-create a contact (parties) for a task owner, so a person is one record
 * across the directory and the owner list. Match order: explicit party_id →
 * exact email → exact name (unambiguous). Creates a minimal contact otherwise.
 * Returns the party id, or null on failure (non-fatal — the owner still gets made).
 */
async function resolveOwnerParty(
  supabase: ReturnType<typeof createAdminClient>,
  name: string,
  email: string | null,
  explicitPartyId: string | null,
): Promise<string | null> {
  if (explicitPartyId) return explicitPartyId
  try {
    if (email) {
      const { data } = await supabase.from('parties').select('id').ilike('email', email).limit(1).maybeSingle()
      if (data) return data.id
    }
    const { data: byName } = await supabase.from('parties').select('id').ilike('full_name', name).limit(2)
    if (byName && byName.length === 1) return byName[0].id
    if (byName && byName.length > 1) return null // ambiguous — don't guess, leave unlinked

    const { data: created, error } = await supabase
      .from('parties')
      .insert({ full_name: name, email, is_organization: false })
      .select('id')
      .single()
    if (error) {
      console.error('Create contact for owner failed:', error)
      return null
    }
    return created.id
  } catch (err) {
    console.error('resolveOwnerParty failed:', err)
    return null
  }
}

/** POST — quick-add a new team member by name (also find-or-creates a contact) */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && viewer.role !== 'executive')) {
    return forbiddenJson('Only admins can add team members')
  }

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null
  const explicitPartyId = typeof body.party_id === 'string' && body.party_id ? body.party_id : null
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Dedupe: repeat quick-adds (or retries after a transient error) shouldn't
  // spawn duplicate rows. If an active member with this name already exists,
  // return it instead of inserting again.
  const { data: existing } = await supabase
    .from('team_members')
    .select('id, name, color, active, created_at')
    .ilike('name', name)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (existing) {
    return Response.json({ member: existing })
  }

  // Pick the next palette color based on current count
  const { count } = await supabase
    .from('team_members')
    .select('*', { count: 'exact', head: true })
  const color = PALETTE[(count ?? 0) % PALETTE.length]

  const partyId = await resolveOwnerParty(supabase, name, email, explicitPartyId)

  const row: TablesInsert<'team_members'> = { name, color, email, party_id: partyId }
  const { data, error } = await supabase.from('team_members').insert(row).select('*').single()

  if (error) {
    console.error('Add team member failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ member: data })
}
