/**
 * Put lead deadlines on the calendar the team actually looks at.
 *
 * A lead carries up to three dates that decide whether a bid is winnable: the
 * bid due date, a (often mandatory) site visit, and the RFI cut-off. Until now
 * all three lived only inside a tailnet-only app that most of the team cannot
 * reach — so a mandatory pre-bid site visit was, in practice, invisible.
 *
 * Written as all-day events keyed by lead id + kind, so a daily sweep never
 * duplicates them and a date that moves MOVES rather than leaving a stale
 * deadline behind. Only leads worth acting on get events: putting every
 * marketing blast on the calendar would make the calendar the next thing
 * nobody reads.
 */

import { upsertCalendarEvent } from '@/lib/integrations/google-workspace'
import { leadsDb, type LeadRow } from './db'

export interface LeadCalendarProgress {
  considered: number
  written: number
  failed: number
  skipped: boolean
  reason?: string
  errors: string[]
}

/** Same bar as the digest: only what a human would want to act on. */
const WORTH_CALENDARING = new Set(['pursue', 'consider'])

type DateKind = 'bid' | 'site_visit' | 'rfi'

const KIND_LABEL: Record<DateKind, string> = {
  bid: 'BID DUE',
  site_visit: 'Site visit',
  rfi: 'RFI deadline',
}

function eventsFor(lead: LeadRow): { kind: DateKind; date: string }[] {
  const out: { kind: DateKind; date: string }[] = []
  if (lead.bid_due_date) out.push({ kind: 'bid', date: lead.bid_due_date })
  if (lead.site_visit_date) out.push({ kind: 'site_visit', date: lead.site_visit_date })
  if (lead.rfi_due_date) out.push({ kind: 'rfi', date: lead.rfi_due_date })
  return out
}

function describe(lead: LeadRow, kind: DateKind): string {
  const lines = [
    lead.summary,
    '',
    lead.sender_company ? `From: ${lead.sender_company}` : null,
    lead.location ? `Location: ${lead.location}` : null,
    lead.estimated_value !== null
      ? `Estimated value: $${Number(lead.estimated_value).toLocaleString('en-US', {
          maximumFractionDigits: 0,
        })}`
      : null,
    lead.solicitation_number ? `Solicitation: ${lead.solicitation_number}` : null,
    lead.fit_recommendation
      ? `Ber AI: ${lead.fit_recommendation.toUpperCase()}${
          lead.fit_score !== null ? ` (${lead.fit_score}/100)` : ''
        }`
      : null,
    kind === 'site_visit' ? '\nAttendance is often mandatory to remain eligible to bid.' : null,
    process.env.APP_URL ? `\n${process.env.APP_URL}/leads?lead=${lead.id}` : null,
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/**
 * Write calendar entries for every open, worth-acting-on lead with a date.
 * Never throws — the leads are safe in the queue whatever the calendar does.
 */
export async function syncLeadDeadlines(): Promise<LeadCalendarProgress> {
  const progress: LeadCalendarProgress = {
    considered: 0,
    written: 0,
    failed: 0,
    skipped: false,
    errors: [],
  }

  if (process.env.LEAD_CALENDAR_SYNC === 'off') {
    return { ...progress, skipped: true, reason: 'LEAD_CALENDAR_SYNC=off' }
  }

  try {
    const { data, error } = await leadsDb()
      .from('leads')
      .select('*')
      .in('status', ['new', 'reviewing'])
      .eq('score_state', 'scored')
    if (error) return { ...progress, skipped: true, reason: error.message }

    const leads = ((data ?? []) as LeadRow[]).filter((l) =>
      WORTH_CALENDARING.has(String(l.fit_recommendation))
    )

    const today = new Date().toISOString().split('T')[0]

    for (const lead of leads) {
      for (const { kind, date } of eventsFor(lead)) {
        // A deadline that has passed is history, not a reminder.
        if (date < today) continue
        progress.considered++

        const res = await upsertCalendarEvent({
          externalId: `lead:${lead.id}:${kind}`,
          summary: `${KIND_LABEL[kind]} — ${lead.title}`.slice(0, 240),
          description: describe(lead, kind),
          location: lead.location,
          date,
        })

        if (res.ok) progress.written++
        else {
          progress.failed++
          if (res.error && progress.errors.length < 5) progress.errors.push(res.error)
        }
      }
    }
  } catch (err) {
    progress.errors.push(err instanceof Error ? err.message : String(err))
  }

  return progress
}
