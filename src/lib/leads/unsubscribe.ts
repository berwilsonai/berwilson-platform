/**
 * One-click unsubscribe (RFC 8058).
 *
 * The only action in this codebase that stops junk at the source rather than
 * hiding it after arrival, and the only one that needs NO Gmail write scope:
 * it is an HTTPS POST to the sender's own endpoint, not a mailbox operation.
 *
 * ⚠ DELIBERATELY NARROW, and every restriction below is load-bearing.
 *
 * - ONE-CLICK ONLY. A bare `List-Unsubscribe: <https://…>` is a link meant for
 *   a human — it may open a preferences page, or a confirmation form, and
 *   POSTing to it blind can do something other than unsubscribe. RFC 8058's
 *   `List-Unsubscribe-Post` header is the sender's explicit statement that an
 *   unattended POST is safe and sufficient. Without it, we do nothing.
 * - HTTPS ONLY. An http:// endpoint would put the address in cleartext, and a
 *   `mailto:` form would mean sending mail as the company to an unverified
 *   address.
 * - NEVER FOLLOW REDIRECTS TO A DIFFERENT ORIGIN. A redirect off the sender's
 *   own host is how an unsubscribe link becomes an open redirect.
 *
 * Unsubscribing also confirms the address is live and monitored, which is why
 * this is driven by a reviewed list rather than fired at anything that looks
 * like marketing. See junk-senders.ts.
 */

/** Unsubscribing tells the sender the address is real; give it a short leash. */
const TIMEOUT_MS = 12_000

export interface UnsubscribeResult {
  ok: boolean
  /** Why it was not attempted, or how it failed. Null on success. */
  reason: string | null
  endpoint: string | null
}

/**
 * The one-click endpoint in a List-Unsubscribe header, or null.
 *
 * The header may hold several values (`<mailto:…>, <https://…>`), so every
 * angle-bracketed entry is examined and only an https one is taken.
 */
export function oneClickEndpoint(
  listUnsubscribe: string | null | undefined,
  listUnsubscribePost: string | null | undefined
): string | null {
  if (!listUnsubscribe) return null
  // The sender must have said an unattended POST is safe.
  if (!/one-?click/i.test(listUnsubscribePost ?? '')) return null

  for (const m of listUnsubscribe.matchAll(/<([^>]+)>/g)) {
    const url = m[1].trim()
    if (/^https:\/\//i.test(url)) return url
  }
  return null
}

/**
 * POST the unsubscribe. Never throws — a sender that is down or hostile must
 * not stop the rest of the run.
 */
export async function unsubscribeOneClick(
  listUnsubscribe: string | null | undefined,
  listUnsubscribePost: string | null | undefined
): Promise<UnsubscribeResult> {
  const endpoint = oneClickEndpoint(listUnsubscribe, listUnsubscribePost)
  if (!endpoint) return { ok: false, reason: 'no one-click endpoint', endpoint: null }

  let origin: string
  try {
    origin = new URL(endpoint).origin
  } catch {
    return { ok: false, reason: 'unparseable endpoint', endpoint }
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      // The exact body RFC 8058 specifies. Senders match on it.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    // A 3xx is normal — most senders redirect to a "you're unsubscribed" page.
    // Following it is unnecessary (the POST already did the work) and following
    // it OFF the sender's own origin is how this becomes an open redirect.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      const sameOrigin = loc ? (() => { try { return new URL(loc, endpoint).origin === origin } catch { return false } })() : true
      return sameOrigin
        ? { ok: true, reason: null, endpoint }
        : { ok: true, reason: `redirected off-origin to ${new URL(loc!, endpoint).origin}; not followed`, endpoint }
    }

    if (res.ok) return { ok: true, reason: null, endpoint }
    return { ok: false, reason: `HTTP ${res.status}`, endpoint }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg.includes('abort') ? 'timed out' : msg.slice(0, 120), endpoint }
  }
}
