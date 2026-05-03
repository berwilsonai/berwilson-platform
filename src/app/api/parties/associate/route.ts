/**
 * POST /api/parties/associate
 *
 * Saves an alias → party mapping so that future emails which mention
 * the same extracted name automatically resolve to the correct contact.
 *
 * Body: { alias: string, party_id: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { alias: string; party_id: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const alias = body.alias?.trim()
  const partyId = body.party_id?.trim()

  if (!alias || !partyId) {
    return NextResponse.json({ error: 'alias and party_id are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the party exists
  const { data: party, error: partyError } = await admin
    .from('parties')
    .select('id, full_name')
    .eq('id', partyId)
    .single()

  if (partyError || !party) {
    return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  }

  // Upsert the alias — if it already points to a different party, update it.
  // Cast to unknown because contact_aliases is a new table not yet in generated types.
  const db = admin as unknown as import('@supabase/supabase-js').SupabaseClient
  const { error } = await db
    .from('contact_aliases')
    .upsert(
      { alias: alias.toLowerCase(), party_id: partyId },
      { onConflict: 'alias', ignoreDuplicates: false }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, party_id: partyId, full_name: party.full_name }, { status: 200 })
}
