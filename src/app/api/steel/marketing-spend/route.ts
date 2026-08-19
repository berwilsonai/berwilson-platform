import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, forbiddenJson } from '@/lib/auth/viewer'
import type { TablesInsert } from '@/lib/supabase/types'

function parse(body: Record<string, unknown>): TablesInsert<'steel_marketing_spend'> | { error: string } {
  const channel = typeof body.channel === 'string' ? body.channel.trim() : ''
  if (!channel) return { error: 'A channel is required.' }
  const amount = Number(body.amount)
  if (!isFinite(amount) || amount < 0) return { error: 'Amount must be a positive number.' }
  const month = typeof body.spend_month === 'string' ? body.spend_month.trim() : ''
  // Accept 'YYYY-MM' or 'YYYY-MM-DD'; store the first of the month.
  const m = /^(\d{4})-(\d{2})/.exec(month)
  if (!m) return { error: 'A month is required.' }
  return {
    channel,
    amount,
    spend_month: `${m[1]}-${m[2]}-01`,
    description: typeof body.description === 'string' ? body.description.trim() || null : null,
    notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parse(body)
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('steel_marketing_spend').insert(parsed).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ spend: data })
}
