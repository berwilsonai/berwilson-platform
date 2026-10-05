/**
 * GET /api/economics/[id]/proposals — what the AI has proposed, pending a human.
 */

import { NextRequest } from 'next/server'
import { requireEconomicsAccess } from '@/lib/economics/access'
import { calcDb } from '@/lib/economics/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response

  const status = new URL(request.url).searchParams.get('status') ?? 'pending'
  const { data, error } = await calcDb()
    .from('economics_input_proposals')
    .select('*')
    .eq('economics_id', id)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ proposals: data ?? [] })
}
