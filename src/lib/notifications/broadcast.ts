/**
 * Mirror activity notifications into the Google Chat space.
 *
 * The bell was built first and works, but it is inside a tailnet-only platform
 * that most of the company cannot reach — and it showed: every notification
 * ever written was still unread. A channel nobody can open is indistinguishable
 * from a channel nobody cares about, and the second reading is wrong here.
 *
 * Same events, same grouping, second channel. Deliberately NOT a second set of
 * rules about what is worth announcing: if it earned a bell row it earns a post,
 * or the two surfaces start disagreeing about what happened.
 *
 * Best-effort in the strongest sense — this is called from Drive syncs and the
 * mail sweep, and a Chat outage must never cost the import that produced it.
 */

import { notify } from '@/lib/notify'
import { isChatConfigured } from '@/lib/notify/chat'
import type { NotificationEvent } from './index'

/** Escape Chat's own markup so a filename containing * or _ renders literally. */
function plain(text: string): string {
  return text.replace(/([*_~`<>])/g, '\\$1')
}

/** Absolute link to an in-app destination, or null when APP_URL is unset. */
function appLink(href: string | null | undefined): string | null {
  const base = process.env.APP_URL?.replace(/\/$/, '')
  if (!base || !href) return null
  return `${base}${href.startsWith('/') ? href : `/${href}`}`
}

function renderEvent(event: NotificationEvent): string {
  const lines = [`*${plain(event.title)}*`]
  if (event.body?.trim()) lines.push(plain(event.body.trim()))

  // Drive first: everyone in the Workspace can open it, whereas the platform
  // link only works for the handful of people on the tailnet. The post is for
  // the people who are NOT in the app.
  const links: string[] = []
  if (event.externalUrl) links.push(`<${event.externalUrl}|Open in Drive>`)
  const inApp = appLink(event.href)
  if (inApp) links.push(`<${inApp}|Open record>`)
  if (links.length) lines.push(links.join(' · '))

  return lines.join('\n')
}

/**
 * Post a run's worth of events as ONE message, threaded by day.
 *
 * One message rather than one per event for the same reason the bell groups
 * above four: a folder link that imports 62 files should read as a line in the
 * space, not as a morning of pings.
 *
 * @returns true when something was delivered.
 */
export async function broadcastEvents(events: NotificationEvent[]): Promise<boolean> {
  if (events.length === 0 || !isChatConfigured()) return false

  try {
    const subject =
      events.length === 1
        ? events[0].title
        : `${events.length} updates across your records`

    const text = events.map(renderEvent).join('\n\n')

    // 'records' resolves to a dedicated space if one is ever configured and
    // falls back to the default otherwise, so naming the intent costs nothing.
    const today = new Date().toISOString().slice(0, 10)
    const res = await notify({
      channel: 'chat',
      to: 'records',
      subject,
      // A single-event post would otherwise repeat its own title, since notify()
      // renders the subject as the first line.
      html: '',
      text: events.length === 1 ? renderEvent(events[0]).split('\n').slice(1).join('\n') : text,
      threadKey: `records-${today}`,
    })
    if (!res.ok) console.error('[notifications] chat broadcast failed:', res.error)
    return res.ok
  } catch (err) {
    console.error(
      '[notifications] chat broadcast failed:',
      err instanceof Error ? err.message : String(err)
    )
    return false
  }
}
