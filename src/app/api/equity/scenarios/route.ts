import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/scenarios — list all scenarios
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await (supabase as any)
    .from('equity_scenarios')
    .select('id, name, description, is_baseline, created_at, updated_at, user_id')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/scenarios — create a new scenario
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const { data, error } = await (supabase as any)
    .from('equity_scenarios')
    .insert({
      user_id: user.id,
      name: body.name || 'Untitled Scenario',
      description: body.description || '',
      valuation_inputs: body.valuation_inputs || {},
      cap_table_inputs: body.cap_table_inputs || {},
      nancy_deal_inputs: body.nancy_deal_inputs || {},
      originator_fee_inputs: body.originator_fee_inputs || {},
      exit_scenario_inputs: body.exit_scenario_inputs || {},
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
