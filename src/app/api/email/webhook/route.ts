import { NextRequest } from 'next/server'
import { processEmailNotification } from '@/lib/email/pipeline'
import type { ChangeNotification } from '@/lib/integrations/microsoft-graph'

/**
 * Microsoft Graph webhook receiver.
 *
 * Two request types hit this endpoint:
 * 1. Validation: Graph sends ?validationToken=xxx on subscription creation.
 *    We must echo it back as text/plain.
 * 2. Notification: Graph POSTs change notifications with a JSON body.
 *    We validate clientState, then process each notification.
 */
export async function POST(request: NextRequest) {
  // --- Validation handshake ---
  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (validationToken) {
    // Graph requires the token echoed back as text/plain with 200
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // --- Change notification ---
  const webhookSecret = process.env.MICROSOFT_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhook] MICROSOFT_WEBHOOK_SECRET not configured')
    return Response.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  let body: { value: ChangeNotification[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.value || !Array.isArray(body.value)) {
    return Response.json({ error: 'Missing notification value array' }, { status: 400 })
  }

  // Graph expects a 202 response within 3 seconds — process async.
  // We respond immediately and process in the background.
  const notifications = body.value

  // Validate clientState on every notification
  const validNotifications = notifications.filter((n) => {
    if (n.clientState !== webhookSecret) {
      console.warn(`[webhook] Invalid clientState on notification for ${n.resource}`)
      return false
    }
    return true
  })

  if (validNotifications.length === 0) {
    return Response.json({ error: 'No valid notifications' }, { status: 403 })
  }

  // Process each notification. Graph notifications include the resource path
  // which contains the message ID. We extract it and run the pipeline.
  // Using Promise.allSettled so one failure doesn't block others.
  const promises = validNotifications.map(async (notification) => {
    const messageId = notification.resourceData?.id
    if (!messageId) {
      console.warn('[webhook] Notification missing resourceData.id')
      return
    }

    // Extract email address from the resource path:
    // "users/info@berwilson.com/mailFolders/inbox/messages"
    const emailMatch = notification.resource.match(/users\/([^/]+)\//)
    const emailAddress = emailMatch?.[1] ?? 'info@berwilson.com'

    try {
      const result = await processEmailNotification(messageId, emailAddress)
      console.log(`[webhook] ${result.status}: message=${messageId}`)
    } catch (err) {
      console.error(`[webhook] Pipeline error for message=${messageId}:`, err)
    }
  })

  // Don't await all — respond fast. But use waitUntil pattern if available.
  // In Vercel Functions (Fluid Compute), the function stays alive for in-flight promises.
  Promise.allSettled(promises).catch((err) =>
    console.error('[webhook] Batch processing error:', err)
  )

  // Respond 202 immediately as Graph requires
  return new Response(null, { status: 202 })
}
