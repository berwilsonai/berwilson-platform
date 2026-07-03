/**
 * GET /api/cron/risk-scores — Compute and persist daily risk scores.
 * Called by Vercel cron or manually via GET.
 */

import { NextRequest, NextResponse } from 'next/server'
import { computeRiskScores, persistRiskScores } from '@/lib/risk-scoring'

export async function GET(request: NextRequest) {
  // Verify cron secret (fail closed if the secret is not configured)
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const scores = await computeRiskScores()
  await persistRiskScores(scores)

  return NextResponse.json({
    computed: scores.length,
    high_risk: scores.filter(s => s.score > 60).length,
    scores: scores.map(s => ({ project: s.project_name, score: s.score, trend: s.trend })),
  })
}
