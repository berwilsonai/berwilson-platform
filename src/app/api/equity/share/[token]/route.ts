import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/share/[token] — resolve a share link (public, no auth)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = createAdminClient()

  // Find the share link
  const { data: link, error: linkError } = await (supabase as any)
    .from('equity_share_links')
    .select('*')
    .eq('token', token)
    .single()

  if (linkError || !link) {
    return NextResponse.json({ error: 'Invalid share link' }, { status: 404 })
  }

  // Check expiration
  if (new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This share link has expired' }, { status: 410 })
  }

  // Check access count
  if (link.accessed_count >= link.max_accesses) {
    return NextResponse.json({ error: 'This share link has reached its access limit' }, { status: 410 })
  }

  // Increment access count
  await (supabase as any)
    .from('equity_share_links')
    .update({ accessed_count: link.accessed_count + 1 })
    .eq('id', link.id)

  // Fetch the scenario
  const { data: scenario, error: scenarioError } = await (supabase as any)
    .from('equity_scenarios')
    .select('*')
    .eq('id', link.scenario_id)
    .single()

  if (scenarioError || !scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
  }

  return NextResponse.json({
    scenario,
    modules: link.modules,
    expiresAt: link.expires_at,
  })
}
