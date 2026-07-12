import { NextRequest } from 'next/server'
import {
  exchangeCodeForTokens,
  storeTokens,
} from '@/lib/integrations/microsoft-graph'
import { publicOrigin } from '@/lib/utils/request-origin'

/**
 * GET /api/email/oauth/callback
 *
 * Microsoft redirects here after the user consents.
 * Does the token exchange entirely server-side — no frontend JS involved.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')
  const errorDescription = request.nextUrl.searchParams.get('error_description')

  if (error) {
    return new Response(html(`
      <h2 style="color:#dc2626">Microsoft Error</h2>
      <p><strong>${escapeHtml(error)}</strong></p>
      <p>${escapeHtml(errorDescription ?? '')}</p>
    `), { status: 400, headers: { 'Content-Type': 'text/html' } })
  }

  if (!code) {
    return new Response(html(`
      <h2 style="color:#dc2626">Missing authorization code</h2>
      <p>Microsoft did not return an authorization code. Try the flow again.</p>
    `), { status: 400, headers: { 'Content-Type': 'text/html' } })
  }

  // Validate state matches our webhook secret
  const expectedState = process.env.MICROSOFT_WEBHOOK_SECRET
  if (!expectedState || state !== expectedState) {
    return new Response(html(`
      <h2 style="color:#dc2626">Invalid state</h2>
      <p>Security check failed. Try the flow again.</p>
    `), { status: 403, headers: { 'Content-Type': 'text/html' } })
  }

  // Must byte-match the redirect_uri sent in the authorize request —
  // both sides now derive it from the forwarded host (see request-origin.ts).
  const redirectUri = `${publicOrigin(request.headers)}/api/email/oauth/callback`

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    await storeTokens(tokens)

    return new Response(html(`
      <h2 style="color:#16a34a">✓ Microsoft connected successfully</h2>
      <p>Access tokens stored. <strong>tuaone@berwilson.com</strong> is authorized.</p>
      <p>Calendar, meeting prep, and email research are back online.</p>
      <p><a href="/settings/health">← Back to System Health</a> to confirm the check is green.</p>
    `), { status: 200, headers: { 'Content-Type': 'text/html' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[oauth/callback] Token exchange failed:', message)

    return new Response(html(`
      <h2 style="color:#dc2626">Token exchange failed</h2>
      <p>${escapeHtml(message)}</p>
      <p>Check that MICROSOFT_CLIENT_SECRET in .env.local on the Studio is the secret <strong>value</strong> (not the ID) and hasn't expired.</p>
    `), { status: 500, headers: { 'Content-Type': 'text/html' } })
  }
}

// This route is on the middleware public allowlist, so query params here are
// attacker-reachable without auth — everything interpolated into the HTML
// must be escaped.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function html(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Ber Wilson — Microsoft OAuth</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 24px; color: #1e293b; }
    pre { overflow-x: auto; }
    code { font-family: monospace; }
  </style>
</head>
<body>${body}</body>
</html>`
}
