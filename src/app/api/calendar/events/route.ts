/**
 * GET /api/calendar/events
 *
 * Fetches Google Calendar events for the primary mailbox.
 * Query params: start, end (ISO date strings)
 * Falls back gracefully if the service account is not configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchCalendarEvents, isGoogleConfigured } from '@/lib/integrations/google-workspace'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const now = new Date()

  const start = searchParams.get('start') ?? new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const end = searchParams.get('end') ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()

  if (!isGoogleConfigured()) {
    return NextResponse.json({
      events: [],
      warning: 'Calendar not connected — the Google service account is not configured. See deploy/google-workspace-setup.md.',
    })
  }

  try {
    const events = await fetchCalendarEvents(start, end)

    return NextResponse.json({
      events: events.map(e => ({
        id: e.id,
        subject: e.subject,
        bodyPreview: e.bodyPreview.slice(0, 200),
        start: e.start,
        end: e.end,
        // Google returns an offset in the timestamp itself, so there is no
        // separate zone to pass through (Graph sent naive UTC + a zone name).
        startTimeZone: null,
        location: e.location,
        organizer: e.organizer?.name ?? null,
        organizerEmail: e.organizer?.email ?? null,
        attendees: e.attendees.map(a => ({
          name: a.name,
          email: a.email,
          response: a.response,
          type: a.optional ? 'optional' : 'required',
        })),
        isAllDay: e.isAllDay,
        webLink: e.webLink,
        joinUrl: e.joinUrl,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calendar fetch failed'
    console.error('[calendar/events] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
