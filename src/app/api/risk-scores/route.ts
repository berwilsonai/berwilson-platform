/**
 * GET /api/risk-scores — Fetch current risk scores for the portfolio.
 * Computes live (doesn't rely on cached cron data).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeRiskScores } from '@/lib/risk-scoring'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scores = await computeRiskScores()

  return NextResponse.json({ scores })
}
