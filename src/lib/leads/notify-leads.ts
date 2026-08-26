/**
 * Announce scored leads by email.
 *
 * The queue at /leads only helps someone who opens it. A `pursue`-rated
 * invitation with a ten-day bid date, sitting unread because nobody happened to
 * look that morning, is precisely the miss this module exists to prevent — so a
 * scored lead pushes itself out rather than waiting to be found.
 *
 * Deliberately a digest, not one mail per lead: a burst of eight invitations on
 * a Monday should be one message that can be read in thirty seconds, not eight
 * that get filed unread.
 *
 * `notified_at` is stamped per lead, so a daily cron announces each lead once
 * and never re-sends. Re-sending every morning until someone acts is how a
 * notification becomes noise, and noise is how the next real bid gets missed.
 *
 * Inert until LEADS_NOTIFY_EMAIL names a recipient — who should be told is a
 * business decision, and mailing a guessed address is worse than not mailing.
 */

import { notify } from '@/lib/notify'
import { leadsDb, type LeadRow } from './db'
import { ROUTE_LABELS } from '@/lib/utils/leads'

export interface LeadNotifyProgress {
  considered: number
  sent: number
  skipped: boolean
  reason?: string
  error?: string
}

/** Only these reach a human unprompted. A `pass` lead is queue material. */
const ANNOUNCE = new Set(['pursue', 'consider'])

/** pursue outranks consider regardless of score — it is a different verdict. */
const RECOMMENDATION_RANK: Record<string, number> = { pursue: 0, consider: 1 }

/**
 * Best first.
 *
 * Quality leads the order because that is what the reader is deciding on, and a
 * digest sorted by deadline puts a mediocre lead that happens to close Friday
 * above the best opportunity of the month. Deadline is not discarded — it
 * breaks ties, and every card still carries its own urgency marker — but it no
 * longer sets the running order.
 */
function byQuality(a: LeadRow, b: LeadRow): number {
  const rank =
    (RECOMMENDATION_RANK[String(a.fit_recommendation)] ?? 9) -
    (RECOMMENDATION_RANK[String(b.fit_recommendation)] ?? 9)
  if (rank !== 0) return rank

  const score = (b.fit_score ?? -1) - (a.fit_score ?? -1)
  if (score !== 0) return score

  // Equal verdict and score: the one closing sooner is the one to act on.
  if (a.bid_due_date && b.bid_due_date) return a.bid_due_date.localeCompare(b.bid_due_date)
  if (a.bid_due_date) return -1
  if (b.bid_due_date) return 1
  return 0
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function daysUntil(date: string | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date + 'T00:00:00').getTime() - Date.now()) / 86_400_000)
}

/** Urgency reads off the bid date, because that is the only deadline that exists. */
function due(lead: LeadRow): { text: string; urgent: boolean } {
  const d = daysUntil(lead.bid_due_date)
  if (d === null) return { text: 'no bid date given', urgent: false }
  if (d < 0) return { text: `bid closed ${-d}d ago`, urgent: true }
  if (d === 0) return { text: 'bid due TODAY', urgent: true }
  return { text: `bid due in ${d}d (${lead.bid_due_date})`, urgent: d <= 7 }
}

export function renderLeadEmail(input: LeadRow[]): { subject: string; html: string } {
  // Sorted here as well as at the query, so any caller gets the same order.
  const leads = [...input].sort(byQuality)
  const urgent = leads.filter((l) => due(l).urgent).length
  const subject =
    leads.length === 1
      ? `New lead: ${leads[0].title.slice(0, 80)}`
      : `${leads.length} new leads${urgent > 0 ? ` — ${urgent} closing soon` : ''}`

  // Deep links need an absolute origin; the platform is tailnet-only, so APP_URL
  // is the only thing that knows it. Without it the mail still reads fine —
  // every link simply degrades to plain text rather than pointing at localhost.
  const appUrl = process.env.APP_URL?.trim().replace(/\/$/, '')

  const cards = leads
    .map((lead) => {
      const d = due(lead)
      const value =
        lead.estimated_value !== null
          ? `$${Number(lead.estimated_value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
          : null
      const facts = [
        lead.sender_company,
        lead.location,
        value,
        ROUTE_LABELS[lead.route] ?? lead.route,
      ]
        .filter(Boolean)
        .map((f) => escapeHtml(String(f)))
        .join(' · ')

      const concerns = Array.isArray(lead.fit_concerns) ? (lead.fit_concerns as string[]) : []
      const concernLine = concerns.length
        ? `<p style="margin:8px 0 0;font-size:13px;color:#92400e">Watch: ${escapeHtml(concerns[0])}</p>`
        : ''

      return `
        <div style="border:1px solid #e2e8f0;border-left:3px solid ${d.urgent ? '#dc2626' : '#274580'};border-radius:8px;padding:14px;margin-bottom:12px">
          <p style="margin:0;font-size:15px;font-weight:600">${
            appUrl
              ? `<a href="${appUrl}/leads?lead=${lead.id}" style="color:#274580;text-decoration:none">${escapeHtml(lead.title)}</a>`
              : `<span style="color:#0f172a">${escapeHtml(lead.title)}</span>`
          }</p>
          <p style="margin:4px 0 0;font-size:13px;color:#475569">${facts}</p>
          <p style="margin:8px 0 0;font-size:13px;${d.urgent ? 'color:#dc2626;font-weight:600' : 'color:#475569'}">${escapeHtml(d.text)}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#0f172a">
            <strong>${String(lead.fit_recommendation ?? '').toUpperCase()}</strong>${
              lead.fit_score !== null ? ` · fit ${lead.fit_score}/100` : ''
            }
          </p>
          ${lead.fit_summary ? `<p style="margin:6px 0 0;font-size:13px;color:#475569">${escapeHtml(lead.fit_summary)}</p>` : ''}
          ${concernLine}
        </div>`
    })
    .join('')

  const link = appUrl
    ? `<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569">
         <a href="${appUrl}/leads" style="color:#274580;font-weight:600;text-decoration:none">Open the lead queue in Ber Intelligence →</a>
       </p>`
    : ''

  return {
    subject,
    html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px">
      <p style="margin:0 0 14px;font-size:13px;color:#475569">
        Scored from inbound mail. Nobody owns these yet — assigning an owner is what turns one into a project, opportunity, or steel deal.${
          appUrl ? ' Tap a title to open it in Ber Intelligence.' : ''
        }
      </p>
      ${cards}${link}
    </div>`,
  }
}

/**
 * Announce every scored, still-undecided lead that has not been announced.
 * Never throws — a notification failure must not fail the sweep that produced
 * the leads, and the leads are safe in the queue either way.
 */
export async function notifyScoredLeads(): Promise<LeadNotifyProgress> {
  const to = process.env.LEADS_NOTIFY_EMAIL?.trim()
  if (!to) {
    return {
      considered: 0,
      sent: 0,
      skipped: true,
      reason: 'LEADS_NOTIFY_EMAIL is not set — no recipient for lead announcements.',
    }
  }

  try {
    const db = leadsDb()
    const { data, error } = await db
      .from('leads')
      .select('*')
      .eq('score_state', 'scored')
      .in('status', ['new', 'reviewing'])
      .is('notified_at', null)
      .order('bid_due_date', { ascending: true, nullsFirst: false })

    if (error) return { considered: 0, sent: 0, skipped: true, error: error.message }

    const rows = ((data ?? []) as LeadRow[])
      .filter((l) => ANNOUNCE.has(String(l.fit_recommendation)))
      .sort(byQuality)
    if (rows.length === 0) return { considered: 0, sent: 0, skipped: false }

    const { subject, html } = renderLeadEmail(rows)
    const result = await notify({ channel: 'email', to, subject, html })

    if (!result.ok) {
      // Leave notified_at null so the next run retries rather than losing them.
      return { considered: rows.length, sent: 0, skipped: false, error: result.error }
    }

    const stamped = new Date().toISOString()
    await db
      .from('leads')
      .update({ notified_at: stamped })
      .in('id', rows.map((r) => r.id))

    return { considered: rows.length, sent: rows.length, skipped: false }
  } catch (err) {
    return {
      considered: 0,
      sent: 0,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
