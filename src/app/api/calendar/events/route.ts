/**
 * GET /api/calendar/events
 *
 * Fetches calendar events from Microsoft Graph for the configured email.
 * Query params: start, end (ISO date strings)
 * Falls back gracefully if no OAuth tokens are configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchCalendarEvents } from '@/lib/integrations/microsoft-graph'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const now = new Date()

  const start = searchParams.get('start') ?? new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const end = searchParams.get('end') ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()

  try {
    const events = await fetchCalendarEvents(start, end)

    return NextResponse.json({
      events: events.map(e => ({
        id: e.id,
        subject: e.subject,
        bodyPreview: e.bodyPreview?.slice(0, 200) ?? '',
        start: e.start.dateTime,
        end: e.end.dateTime,
        startTimeZone: e.start.timeZone,
        location: e.location?.displayName ?? null,
        organizer: e.organizer?.emailAddress?.name ?? null,
        organizerEmail: e.organizer?.emailAddress?.address ?? null,
        attendees: e.attendees?.map(a => ({
          name: a.emailAddress.name,
          email: a.emailAddress.address,
          response: a.status.response,
          type: a.type,
        })) ?? [],
        isAllDay: e.isAllDay,
        webLink: e.webLink,
        joinUrl: e.onlineMeeting?.joinUrl ?? null,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calendar fetch failed'

    // Graceful degradation if no tokens configured
    if (message.includes('No stored tokens') || message.includes('Token exchange')) {
      return NextResponse.json({
        events: [],
        warning: 'Calendar not connected. Run the OAuth flow at /api/email/oauth to connect Microsoft 365.',
      })
    }

    console.error('[calendar/events] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
