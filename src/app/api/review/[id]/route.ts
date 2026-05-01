import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_RESOLUTIONS = ['approved', 'rejected'] as const
type Resolution = (typeof VALID_RESOLUTIONS)[number]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let resolution: Resolution
  try {
    const body = await request.json()
    if (!VALID_RESOLUTIONS.includes(body.resolution)) {
      return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })
    }
    resolution = body.resolution
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('review_queue')
    .update({
      resolution,
      resolved_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq('id', id)
    .is('resolved_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
