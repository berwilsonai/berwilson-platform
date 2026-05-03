/**
 * POST /api/eval/rate
 * Body: { table: 'ai_queries' | 'agent_messages', id: string, rating: 1 | -1 }
 *
 * Records a thumbs-up (1) or thumbs-down (-1) on an AI response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_TABLES = ['ai_queries', 'agent_messages'] as const
type RatableTable = (typeof ALLOWED_TABLES)[number]

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { table?: string; id?: string; rating?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { table, id, rating } = body

  if (!ALLOWED_TABLES.includes(table as RatableTable)) {
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 })
  }
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  if (rating !== 1 && rating !== -1) {
    return NextResponse.json({ error: 'rating must be 1 or -1' }, { status: 400 })
  }

  const admin = createAdminClient()
  // rating column is new — cast until gen-types is re-run after migration
  const { error } = await (admin as unknown as import('@supabase/supabase-js').SupabaseClient)
    .from(table as never)
    .update({ rating } as never)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
