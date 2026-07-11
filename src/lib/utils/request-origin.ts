/**
 * The app's public origin as the user sees it, derived from forwarded headers.
 *
 * On the Studio, `tailscale serve` proxies https://richards-mac-studio.…ts.net
 * → localhost:3000 and rewrites the Host header to the backend, so
 * `request.nextUrl.origin` comes out as https://localhost:3000 — wrong for
 * anything user-facing (OAuth redirect URIs, links in emails, etc.).
 * The real host travels in x-forwarded-host; prefer it.
 */
export function publicOrigin(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
  const proto = headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
