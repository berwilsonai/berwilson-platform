import { NextRequest } from 'next/server'
import {
  exchangeCodeForTokens,
  storeTokens,
} from '@/lib/integrations/microsoft-graph'

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
      <p><strong>${error}</strong></p>
      <p>${errorDescription ?? ''}</p>
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

  const origin = request.nextUrl.origin
  const redirectUri = `${origin}/api/email/oauth/callback`

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    await storeTokens(tokens)

    return new Response(html(`
      <h2 style="color:#16a34a">✓ Microsoft connected successfully</h2>
      <p>Access tokens stored. <strong>info@berwilson.com</strong> is authorized.</p>
      <p>Next step: create the inbox subscription so emails start flowing.</p>
      <br/>
      <p>Run this in your browser console on the platform, or ask Claude to call <code>POST /api/email/subscribe</code>:</p>
      <pre style="background:#f1f5f9;padding:12px;border-radius:6px;font-size:13px">fetch('https://berwilson-platform-nu.vercel.app/api/email/subscribe', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: '{}',
  credentials: 'include'
}).then(r=>r.json()).then(console.log)</pre>
    `), { status: 200, headers: { 'Content-Type': 'text/html' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[oauth/callback] Token exchange failed:', message)

    return new Response(html(`
      <h2 style="color:#dc2626">Token exchange failed</h2>
      <p>${message}</p>
      <p>Check that MICROSOFT_CLIENT_SECRET in Vercel is the secret <strong>value</strong> (not the ID).</p>
    `), { status: 500, headers: { 'Content-Type': 'text/html' } })
  }
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
