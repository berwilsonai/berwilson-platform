/**
 * GET /api/ai/queries — recent query history for the current user
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '20')

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('ai_queries')
    .select('id, query_text, model_used, latency_ms, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ queries: data ?? [] })
}
