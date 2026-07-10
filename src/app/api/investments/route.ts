import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parseInvestmentFields, type InvestmentBody } from '@/lib/investors/parse'

export async function POST(request: NextRequest) {
  // /api/investments is not in any role allowlist (admin-only via middleware);
  // this check is defense-in-depth.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: InvestmentBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const investor_id = typeof body.investor_id === 'string' ? body.investor_id : null
  if (!investor_id) return Response.json({ error: 'investor_id is required' }, { status: 400 })

  const result = parseInvestmentFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('investments')
    .insert({ investor_id, ...result.fields })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Surface activity on the investor list
  await supabase.from('investors').update({ updated_at: new Date().toISOString() }).eq('id', investor_id)

  // Refresh the searchable snapshot (skips pre-migration)
  embedInvestorSnapshot(investor_id).catch(console.error)

  return Response.json({ investment: data })
}
