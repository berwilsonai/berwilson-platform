import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const q = request.nextUrl.searchParams.get('q') ?? ''

  let query = admin
    .from('parties')
    .select('id, full_name, company, title')
    .eq('status', 'active')
    .order('full_name')
    .limit(200)

  if (q) {
    query = query.ilike('full_name', `%${q}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    full_name: string
    email?: string
    company?: string
    title?: string
    phone?: string
    relationship_notes?: string
    is_organization?: boolean
    entity_id?: string  // link to existing entity
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.full_name?.trim()) {
    return NextResponse.json({ error: 'full_name is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const companyName = body.company?.trim() ?? null
  const isOrg = body.is_organization ?? false

  const { data, error } = await admin
    .from('parties')
    .insert({
      full_name: body.full_name.trim(),
      email: body.email?.trim() ?? null,
      company: companyName,
      title: body.title?.trim() ?? null,
      phone: body.phone?.trim() ?? null,
      relationship_notes: body.relationship_notes?.trim() ?? null,
      is_organization: isOrg,
    })
    .select('id, full_name, email, company, title')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-link to company entity (find-or-create)
  if (companyName && !isOrg) {
    let linkedEntityId = body.entity_id ?? null

    if (!linkedEntityId) {
      // Check for existing entity by name
      const { data: existing } = await admin
        .from('entities')
        .select('id')
        .ilike('name', companyName)
        .limit(1)
        .single()

      if (existing) {
        linkedEntityId = existing.id
      } else {
        // Auto-create entity
        const { data: newEntity } = await admin
          .from('entities')
          .insert({ name: companyName, entity_type: 'other' as const })
          .select('id')
          .single()
        linkedEntityId = newEntity?.id ?? null
      }
    }

    if (linkedEntityId) {
      const adminDb = admin as unknown as import('@supabase/supabase-js').SupabaseClient
      await adminDb
        .from('party_entities')
        .insert({ party_id: data.id, entity_id: linkedEntityId, role: 'employee', is_primary: true })
    }
  }

  return NextResponse.json(data, { status: 201 })
}
