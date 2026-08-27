/**
 * Google Chat delivery, via an incoming webhook.
 *
 * Chosen over Telegram (the channel this seam was originally built for) for one
 * reason: it is already in the Workspace. Nobody installs an app, creates an
 * account, or gets added to a second directory — the space exists, the team is
 * already in it, and a webhook is a URL. For a company where most people cannot
 * reach the platform at all, the cheapest possible push is the right one.
 *
 * Deliberately an INCOMING webhook rather than a Chat app. A Chat app would let
 * people ask Ber AI from the space, which is genuinely attractive, but it needs
 * Google to call INTO the platform — and the platform is tailnet-only with no
 * public endpoint. Outbound works today; inbound is blocked by the network
 * shape, not by effort.
 *
 * A webhook URL carries its own auth token in the query string, so it is a
 * secret: it lives in env, never in the database and never in client code.
 */

const CHAT_TIMEOUT_MS = 10_000

/**
 * Resolve a destination to a webhook URL.
 *
 * `to` is either the URL itself, or a short space key — `default` reads
 * GOOGLE_CHAT_WEBHOOK_URL, anything else reads GOOGLE_CHAT_WEBHOOK_URL_<KEY>.
 * Keys let a second space be added later (steel, leads) without touching this
 * file or the notify seam.
 */
export function resolveChatWebhook(to: string): string | null {
  const value = to.trim()
  if (/^https:\/\//i.test(value)) return value

  const key = value.toLowerCase()
  const env =
    key === '' || key === 'default'
      ? process.env.GOOGLE_CHAT_WEBHOOK_URL
      : process.env[`GOOGLE_CHAT_WEBHOOK_URL_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]

  return env?.trim() || null
}

/** True when at least the default space is wired up. */
export function isChatConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim())
}

/**
 * Post a message to a space.
 *
 * Chat's text format is its own small dialect — `*bold*`, `_italic_`,
 * and `<url|label>` for links — NOT markdown, and not HTML. Callers build text
 * in that dialect; {@link htmlToChatText} converts when only HTML exists.
 */
export async function sendChat(to: string, text: string, threadKey?: string): Promise<void> {
  const webhook = resolveChatWebhook(to)
  if (!webhook) {
    throw new Error(
      `No Google Chat webhook for "${to}". Set GOOGLE_CHAT_WEBHOOK_URL (Chat → the space → Apps & integrations → Webhooks).`
    )
  }

  // A threadKey groups related posts into one conversation in the space, so a
  // daily digest reads as a running thread instead of flooding the room.
  const url = threadKey
    ? `${webhook}${webhook.includes('?') ? '&' : '?'}messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD&threadKey=${encodeURIComponent(threadKey)}`
    : webhook

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // The token is in the URL, so the URL must never reach a log line.
    throw new Error(`Google Chat rejected the message: ${res.status} ${body.slice(0, 200)}`)
  }
}

/**
 * Best-effort HTML → Chat text, for callers that only have an email body.
 *
 * Purpose-built rather than reusing the mail parser: this one has to preserve
 * links as `<url|label>`, which is the one thing that makes a Chat message
 * actionable rather than a wall of prose.
 */
export function htmlToChatText(html: string): string {
  // Links are lifted out FIRST and put back LAST. Building `<url|label>` inline
  // does not survive: the generic tag strip that follows sees the angle brackets
  // and eats the link whole — which is exactly what happened the first time, and
  // silently, since the label vanished with it.
  const links: string[] = []
  const withPlaceholders = html.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, label) => {
      const text = String(label).replace(/<[^>]+>/g, '').trim()
      links.push(`<${href}|${text || href}>`)
      return `\u0000L${links.length - 1}\u0000`
    }
  )

  const text = withPlaceholders
    .replace(
      /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      (_m, _t, inner) => `*${String(inner).replace(/<[^>]+>/g, '').trim()}*`
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    // `li` is absent deliberately — the opening tag already broke the line, and
    // closing it too would double-space every bullet list.
    .replace(/<\/(p|div|tr|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    // Ampersand last, so "&amp;lt;" cannot decode twice into a stray tag.
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.replace(/\u0000L(\d+)\u0000/g, (_m, i) => links[Number(i)] ?? '')
}
