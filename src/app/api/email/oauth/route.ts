import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildAuthUrl } from '@/lib/integrations/microsoft-graph'

/**
 * GET /api/email/oauth
 * Redirects the authenticated user directly to Microsoft's consent screen.
 * On consent, Microsoft redirects to /api/email/oauth/callback where the
 * token exchange happens entirely server-side.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized — log into the platform first' }, { status: 401 })
  }

  const origin = request.nextUrl.origin
  const redirectUri = `${origin}/api/email/oauth/callback`

  // Use webhook secret as state — simple, no session dependency at callback time
  const state = process.env.MICROSOFT_WEBHOOK_SECRET!

  const authUrl = buildAuthUrl(redirectUri, state)

  // Redirect directly — no JSON, no frontend JS needed
  return Response.redirect(authUrl)
}
