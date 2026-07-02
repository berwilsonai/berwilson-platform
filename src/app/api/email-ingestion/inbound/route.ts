import { NextRequest } from 'next/server'
import {
  analyzeEmailReport,
  EmailIntakeError,
  SYSTEM_USER_ID,
} from '@/lib/email-ingestion/analyze'

export const maxDuration = 300

/**
 * Inbound report delivery from n8n (NOT a logged-in browser).
 *
 * This route is on middleware's public allowlist, so its only auth is the
 * X-Ingestion-Secret header. It runs the exact same shared processing path as the
 * manual paste flow (`analyzeEmailReport`) and stages a pending review session —
 * it never auto-confirms or creates any records.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.INGESTION_INBOUND_SECRET
  const provided = request.headers.get('x-ingestion-secret')
  if (!expected || !provided || provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const rawText = typeof body.raw_text === 'string' ? body.raw_text.trim() : ''
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null

  if (!rawText) {
    return Response.json({ error: 'raw_text is required' }, { status: 400 })
  }

  try {
    const result = await analyzeEmailReport({ rawText, label, userId: SYSTEM_USER_ID })
    // Return only a minimal receipt — the report lands under Email Ingestion > Recent.
    return Response.json({ ok: true, session_id: result.session_id })
  } catch (err) {
    if (err instanceof EmailIntakeError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('Inbound email ingestion failed:', err)
    return Response.json({ error: 'Ingestion failed.' }, { status: 500 })
  }
}
