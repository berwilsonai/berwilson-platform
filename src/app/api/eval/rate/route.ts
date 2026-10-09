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
  // ⚠ THIS USED TO ESCAPE THROUGH AN UNTYPED SupabaseClient, with a comment
  // saying "cast until gen-types is re-run after migration". gen-types was a
  // disabled stub, so that day never came. It has now (2026-10-08), and the
  // two tables are branched so each write is checked against its own row.
  const { error } =
    table === 'ai_queries'
      ? await admin.from('ai_queries').update({ rating }).eq('id', id)
      : await admin.from('agent_messages').update({ rating }).eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
