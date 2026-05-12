import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

// POST /api/share — create a share link
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    scenarioId,
    modules = ['exit-scenarios', 'cap-table', 'investor-deal', 'valuation', 'originator-fees'],
    expiresInDays = 7,
    maxAccesses = 10,
  } = body as {
    scenarioId: string
    modules?: string[]
    expiresInDays?: number
    maxAccesses?: number
  }

  // Verify scenario exists
  const { data: scenario } = await (supabase as any)
    .from('equity_scenarios')
    .select('id')
    .eq('id', scenarioId)
    .single()

  if (!scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)

  const { data, error } = await (supabase as any)
    .from('equity_share_links')
    .insert({
      scenario_id: scenarioId,
      token,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
      modules,
      max_accesses: maxAccesses,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ...data,
    url: `${request.nextUrl.origin}/equity/share/${token}`,
  }, { status: 201 })
}
