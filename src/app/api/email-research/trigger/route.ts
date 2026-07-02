import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Kicks off an Email Research run in n8n. Server-side only.
 *
 * Requires a logged-in session (same as the /email-research page). Makes a
 * server-to-server POST to the n8n webhook and returns as soon as the request is
 * dispatched — it does NOT wait for n8n to finish the run. The finished report
 * comes back later via /api/email-ingestion/inbound and appears under
 * Email Ingestion > Recent.
 *
 * The n8n webhook URL and secret live ONLY in server env vars — they are never
 * sent to the client nor included in any response.
 */
export async function POST(request: NextRequest) {
  // Auth: reject if not logged in (middleware also guards /api/*, this is explicit).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const searchTerm = typeof body.searchTerm === 'string' ? body.searchTerm.trim() : ''
  const exportLabel = typeof body.exportLabel === 'string' ? body.exportLabel.trim() : ''

  if (!searchTerm) {
    return Response.json({ error: 'A search term is required.' }, { status: 400 })
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET
  if (!webhookUrl || !webhookSecret) {
    console.error('Email research trigger not configured: N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET missing.')
    return Response.json({ error: 'Email research is not configured yet.' }, { status: 503 })
  }

  // Fire the webhook. n8n acks on receipt (it doesn't run synchronously), so we
  // await only the dispatch and cap it so a hung webhook can't block the request.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': webhookSecret,
      },
      body: JSON.stringify({ searchTerm, exportLabel }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error(`Email research webhook returned ${res.status}`)
      return Response.json({ error: 'Could not start the research run. Try again shortly.' }, { status: 502 })
    }
  } catch (err) {
    console.error('Email research webhook dispatch failed:', err)
    return Response.json({ error: 'Could not reach the research service. Try again shortly.' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }

  return Response.json({ ok: true })
}
