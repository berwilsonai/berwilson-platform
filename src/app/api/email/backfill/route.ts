import { NextRequest, NextResponse } from 'next/server'
import { getValidAccessToken } from '@/lib/integrations/microsoft-graph'
import { processEmailNotification } from '@/lib/email/pipeline'

export const maxDuration = 300 // 5 minutes

const TARGET_EMAIL = 'info@berwilson.com'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const MAX_WEEKS = 8

export async function POST(req: NextRequest) {
  let weeks: number
  let limit: number | null = null
  try {
    const body = await req.json()
    weeks = Math.min(Math.max(1, parseInt(String(body.weeks ?? 2), 10)), MAX_WEEKS)
    if (isNaN(weeks)) weeks = 2
    if (body.limit) {
      const l = parseInt(String(body.limit), 10)
      if (!isNaN(l) && l > 0) limit = l
    }
  } catch {
    weeks = 2
  }

  const since = new Date()
  since.setDate(since.getDate() - weeks * 7)

  let token: string
  try {
    token = await getValidAccessToken(TARGET_EMAIL)
  } catch (err) {
    return NextResponse.json(
      { error: 'Auth failed — run the OAuth flow first: ' + String(err) },
      { status: 500 }
    )
  }

  // Collect all message IDs via pagination
  const messageIds: string[] = []
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)
  let url: string | null =
    `${GRAPH_BASE}/users/${TARGET_EMAIL}/mailFolders/inbox/messages` +
    `?$filter=${filter}&$select=id&$top=100&$orderby=receivedDateTime desc`

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json(
        { error: `Graph API error listing messages: ${res.status} — ${txt}` },
        { status: 502 }
      )
    }
    const data: { value: { id: string }[]; '@odata.nextLink'?: string } = await res.json()
    messageIds.push(...data.value.map((m) => m.id))
    url = data['@odata.nextLink'] ?? null
  }

  // Optionally cap the number of messages processed (useful for testing)
  const messagesToProcess = limit ? messageIds.slice(0, limit) : messageIds

  // Process each message through the existing pipeline.
  // processEmailNotification is idempotent — already-processed emails are skipped.
  let processed = 0
  let skipped = 0
  let failed = 0

  for (const msgId of messagesToProcess) {
    const result = await processEmailNotification(msgId, TARGET_EMAIL)
    if (result.status === 'processed') processed++
    else if (result.status === 'failed') failed++
    else skipped++ // duplicate, junk

    // Brief pause between calls to respect Graph API rate limits
    await new Promise((r) => setTimeout(r, 150))
  }

  return NextResponse.json({
    total: messageIds.length,
    processed,
    skipped,
    failed,
    weeks,
    limited: limit ? messagesToProcess.length : null,
  })
}
