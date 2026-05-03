import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSubscription } from '@/lib/integrations/microsoft-graph'

const TARGET_EMAIL = 'info@berwilson.com'

async function runSubscription(origin: string) {
  const notificationUrl = `${origin}/api/email/webhook`

  // Check that OAuth tokens exist before attempting subscription
  const admin = createAdminClient()
  const { data: token } = await admin
    .from('email_tokens')
    .select('email_address, expires_at')
    .eq('email_address', TARGET_EMAIL)
    .single()

  if (!token) {
    return {
      ok: false,
      message: `No OAuth tokens found for ${TARGET_EMAIL}. Complete the OAuth flow first.`,
      action: 'Visit /api/email/oauth to authorize Microsoft email access.',
    }
  }

  const subscription = await createSubscription(notificationUrl, TARGET_EMAIL)

  return {
    ok: true,
    message: `Webhook subscription active for ${TARGET_EMAIL}`,
    subscription_id: subscription.id,
    expires: subscription.expirationDateTime,
    notification_url: notificationUrl,
  }
}

/** GET — callable directly from the browser after OAuth */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized — log in first' }, { status: 401 })

  try {
    const result = await runSubscription(request.nextUrl.origin)
    return Response.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[subscribe] Failed:', message)
    return Response.json({ error: 'Failed to create webhook subscription', detail: message }, { status: 500 })
  }
}

/** POST — for programmatic use */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await runSubscription(request.nextUrl.origin)
    return Response.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[subscribe] Failed:', message)
    return Response.json({ error: 'Failed to create webhook subscription', detail: message }, { status: 500 })
  }
}
