import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { ScenarioPDF } from '@/lib/equity/pdf/scenario-pdf'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { scenarioId, modules } = body as {
    scenarioId: string
    modules?: string[]
  }

  const { data: scenario, error } = await (supabase as any)
    .from('equity_scenarios')
    .select('*')
    .eq('id', scenarioId)
    .single()

  if (error || !scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
  }

  const buffer = await renderToBuffer(
    ScenarioPDF({
      scenario,
      modules: modules ?? ['exit-scenarios', 'cap-table', 'investor-deal', 'valuation', 'originator-fees'],
      generatedBy: user.email ?? 'Unknown',
    })
  )

  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ber-wilson-equity-${scenario.name.toLowerCase().replace(/\s+/g, '-')}.pdf"`,
    },
  })
}
