import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { fetchCalendarEvents } from '@/lib/integrations/microsoft-graph'

export const maxDuration = 60

/**
 * GET /api/meeting-intake/calendar-events
 *
 * Recent + imminent calendar events from the connected mailbox, so the meeting
 * form can prefill the title/date and seed the real attendee list. Degrades to
 * `{ events: [], error }` when Graph is unavailable (token stale, etc.) — the
 * paste flow still works without it.
 */
export async function GET() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson('Admins only')

  const now = Date.now()
  const start = new Date(now - 21 * 24 * 3600 * 1000).toISOString() // last 3 weeks
  const end = new Date(now + 2 * 24 * 3600 * 1000).toISOString() // through tomorrow

  try {
    const events = await fetchCalendarEvents(start, end)
    const dateFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }) // YYYY-MM-DD

    const mapped = events
      .filter((e) => !e.isAllDay)
      .map((e) => {
        // Graph returns naive datetimes in UTC by default; pin to UTC then format.
        const d = new Date(`${e.start.dateTime}Z`)
        const seen = new Set<string>()
        const attendees = (e.attendees ?? [])
          .map((a) => ({ name: a.emailAddress?.name?.trim() || a.emailAddress?.address || '', email: a.emailAddress?.address?.toLowerCase() || null }))
          .filter((a) => a.name && !seen.has(a.email ?? a.name) && seen.add(a.email ?? a.name))
        return {
          id: e.id,
          subject: e.subject || '(no subject)',
          date: isNaN(d.getTime()) ? null : isoFmt.format(d),
          when: isNaN(d.getTime()) ? '' : dateFmt.format(d),
          sortKey: d.getTime() || 0,
          attendees,
        }
      })
      .sort((a, b) => b.sortKey - a.sortKey) // most recent first
      .slice(0, 30)

    return Response.json({ events: mapped })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calendar unavailable'
    console.error('calendar-events failed:', message)
    return Response.json({ events: [], error: 'Could not reach the calendar. Reconnect the mailbox on /settings/health, or just paste the notes.' })
  }
}
