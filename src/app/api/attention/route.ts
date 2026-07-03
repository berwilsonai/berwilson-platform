/**
 * GET /api/attention
 *
 * Returns everything that's falling through the cracks.
 * The engine lives in src/lib/attention.ts (shared with the agent's
 * get_attention_items tool).
 */

import { NextResponse } from 'next/server'
import { computeAttention } from '@/lib/attention'

export async function GET() {
  const result = await computeAttention()
  return NextResponse.json(result)
}
