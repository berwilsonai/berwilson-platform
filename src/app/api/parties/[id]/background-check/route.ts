import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  let body: {
    background_check_completed?: boolean
    background_check_date?: string | null
    background_check_reference?: string | null
    background_check_provider?: string | null
    background_check_notes?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('parties')
    .update({
      background_check_completed: body.background_check_completed ?? false,
      background_check_date: body.background_check_date ?? null,
      background_check_reference: body.background_check_reference ?? null,
      background_check_provider: body.background_check_provider ?? null,
      background_check_notes: body.background_check_notes ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ party: data })
}
