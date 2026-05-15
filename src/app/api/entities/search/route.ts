import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** GET /api/entities/search?q=acme — fuzzy search entities for autocomplete */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) {
    return NextResponse.json([])
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('entities')
    .select('id, name, entity_type, headquarters')
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(15)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
