/**
 * The pre-meeting nudge — the same context, delivered when it is usable.
 *
 * ⚠ PEPPER ALREADY ASSEMBLES ALL OF THIS AND DELIVERS IT UP TO TEN HOURS
 * EARLY. `assembleMeetings` reads the day's calendar, resolves every external
 * attendee against the correspondence, and reports when we last spoke to them
 * and what is open with them in either direction — and then puts it in a 06:50
 * email, which for a 4pm meeting is read nine hours before it is needed and
 * remembered by nobody. The note still carries the day's shape, which is what a
 * morning note is for; this is the same facts again at the moment they change
 * what somebody says.
 *
 * ⚠ AND IT MAKES NO MODEL CALL, DELIBERATELY. LM Studio serves one request at a
 * time and nothing in this repo queues; a pass that fires every fifteen minutes
 * through the working day and wanted the GPU would sit in front of the agent
 * every time an executive was mid-question. Everything here is already a fact —
 * a name, a date, an open obligation — and §12's rule is to print the figure
 * rather than make the model repeat it. There is nothing to compose.
 */

import { fetchCalendarEvents } from '@/lib/integrations/google-workspace'
import { readOpenCommitments } from '@/lib/commitments/read'
import { COMMITMENT_MATCH_THRESHOLD, commitmentSimilarity } from '@/lib/commitments/db'
import { sweepDb } from '@/lib/email-sweep/db'
import type { PepperMember } from './attribution'

/** How far ahead to look. One cron interval plus a margin. */
export const LOOKAHEAD_MIN = 35
/** How close is too close — below this the nudge arrives after they walked in. */
export const LEAD_TIME_MIN = 5
/** A contact we have not spoken to in this long is worth flagging. */
const STALE_CONTACT_DAYS = 21

/**
 * Who counts as "us".
 *
 * Built from the roster rather than hard-coded, so adding an executive needs no
 * code change — and it carries ADDRESSES as well as domains for the reason in
 * `isExternal` below.
 */
export function internalSet(members: PepperMember[]): {
  domains: Set<string>
  addresses: Set<string>
} {
  const domains = new Set<string>()
  const addresses = new Set<string>()
  for (const m of members) {
    for (const a of m.addresses) {
      addresses.add(a)
      const d = a.split('@')[1]
      if (d) domains.add(d)
    }
  }
  return { domains, addresses }
}

export interface PrepCounterparty {
  name: string
  email: string
  lastContactDays: number | null
  openItems: { what: string; side: 'us' | 'them'; dueDate: string | null }[]
}

export interface MeetingPrep {
  /** The calendar event id — the dedupe key, so one nudge per meeting ever. */
  eventId: string
  subject: string
  start: string
  minutesAway: number
  location: string | null
  counterparties: PrepCounterparty[]
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

/**
 * Meetings starting soon on one person's calendar, with their context.
 *
 * ⚠ EXTERNAL ATTENDEES ONLY, AND THAT IS WHAT MAKES IT WORTH SENDING. A
 * one-to-one between the two executives needs no briefing, and a nudge about it
 * is the padding that teaches someone to filter the channel. A meeting whose
 * only other attendee is the other executive produces no prep at all.
 */
export async function prepsForMember(
  member: PepperMember,
  /** Every domain and every address that counts as one of us. See `internalSet`. */
  internal: { domains: Set<string>; addresses: Set<string> },
  now = new Date()
): Promise<{ preps: MeetingPrep[]; notes: string[] }> {
  const notes: string[] = []

  const windowEnd = new Date(now.getTime() + LOOKAHEAD_MIN * 60_000)
  let events
  try {
    events = await fetchCalendarEvents(now.toISOString(), windowEnd.toISOString(), member.mailbox)
  } catch (err) {
    // Said out loud rather than swallowed: silence here is indistinguishable
    // from an empty calendar, which is the one thing it must not look like.
    notes.push(
      `Calendar unavailable for ${member.email}: ${err instanceof Error ? err.message : String(err)}`
    )
    return { preps: [], notes }
  }

  const soon = events.filter((e) => {
    if (e.isAllDay) return false
    const minutesAway = Math.round((new Date(e.start).getTime() - now.getTime()) / 60_000)
    return minutesAway >= LEAD_TIME_MIN && minutesAway <= LOOKAHEAD_MIN
  })
  if (soon.length === 0) return { preps: [], notes }

  /**
   * ⚠ ADDRESS FIRST, THEN DOMAIN. A domain-only test announced Richard as an
   * external counterparty on Eric's nudge and recited Richard's own open
   * commitments as the counterparty's, because he attends some meetings from
   * the personal address his own contact record carries. §12's rule about never
   * printing a reader's own name back at them has a sibling here: never print
   * their colleague back at them as the other side.
   */
  const isExternal = (email: string) => {
    const addr = email.toLowerCase()
    if (internal.addresses.has(addr)) return false
    const domain = addr.split('@')[1]
    return !!domain && !internal.domains.has(domain)
  }

  const emails = [
    ...new Set(
      soon.flatMap((e) => e.attendees.map((a) => a.email.toLowerCase())).filter(isExternal)
    ),
  ]
  if (emails.length === 0) return { preps: [], notes }

  const context = await counterpartyContext(emails)

  const preps: MeetingPrep[] = []
  for (const e of soon) {
    const counterparties = e.attendees
      .filter((a) => isExternal(a.email))
      .slice(0, 6)
      .map((a) => {
        const ctx = context.get(a.email.toLowerCase())
        return {
          name: a.name || a.email,
          email: a.email,
          lastContactDays: ctx?.lastContactDays ?? null,
          openItems: ctx?.openItems ?? [],
        }
      })
    // An internal-only meeting produces nothing. See the note above.
    if (counterparties.length === 0) continue

    preps.push({
      eventId: e.id,
      subject: e.subject,
      start: e.start,
      minutesAway: Math.round((new Date(e.start).getTime() - now.getTime()) / 60_000),
      location: e.location,
      counterparties,
    })
  }

  return { preps, notes }
}

/**
 * Last contact and open obligations for a set of addresses.
 *
 * ⚠ THE COMMITMENTS COME THROUGH readOpenCommitments, which is what keeps a
 * protected project's obligations out of an outbound message. This reads the
 * thread table directly for last-contact — that carries no project pointer, so
 * there is nothing there to withhold.
 */
async function counterpartyContext(
  emails: string[]
): Promise<Map<string, { lastContactDays: number | null; openItems: PrepCounterparty['openItems'] }>> {
  const out = new Map<
    string,
    { lastContactDays: number | null; openItems: PrepCounterparty['openItems'] }
  >()
  if (emails.length === 0) return out

  try {
    const { data: threads } = await sweepDb()
      .from('email_threads')
      .select('id, participants, last_at')
      .overlaps('participants', emails)
      .order('last_at', { ascending: false })
      .limit(200)

    const rows = (threads ?? []) as { id: string; participants: string[]; last_at: string | null }[]
    if (rows.length === 0) return out

    const threadIds = new Set(rows.map((r) => r.id))
    const { rows: commitments } = await readOpenCommitments({ excludeSnoozed: true, limit: 1000 })

    const byThread = new Map<string, PrepCounterparty['openItems']>()
    for (const c of commitments) {
      if (!threadIds.has(c.thread_id)) continue
      const list = byThread.get(c.thread_id) ?? []
      list.push({ what: c.what, side: c.side, dueDate: c.due_date })
      byThread.set(c.thread_id, list)
    }

    for (const email of emails) {
      const theirs = rows.filter((r) => (r.participants ?? []).some((p) => p.toLowerCase() === email))
      if (theirs.length === 0) continue
      const open: PrepCounterparty['openItems'] = []
      for (const t of theirs) for (const c of byThread.get(t.id) ?? []) open.push(c)
      out.set(email, {
        lastContactDays: daysSince(theirs[0].last_at),
        // Capped AFTER deduping: this is read standing up, on a phone, minutes
        // before a conversation. Four is what fits before it stops being a
        // glance — and four slots filled by one obligation is no glance at all.
        openItems: dedupeItems(open).slice(0, 4),
      })
    }
  } catch {
    // Context is a courtesy; the meeting line stands without it.
  }
  return out
}

/**
 * Collapse the same obligation phrased from several threads.
 *
 * ⚠ FOUND BY RUNNING IT. `commitments` is unique on (thread_id, item_key), so
 * one real obligation discussed across three threads is three rows — and the
 * first live nudge listed "Countersign and return the GridEdge MNDA" twice and
 * "Review and sign the GridEdge MNDA" beside it, spending three of four slots
 * on one MNDA while the rest of the relationship went unmentioned.
 *
 * Pepper's morning note does not need this because its prompt already says
 * several commitments about one deal are ONE line. This pass has no model, so
 * the collapsing has to happen in code — which is the right trade either way:
 * §12, print the figure rather than make the model repeat it.
 *
 * Reuses the ledger's own similarity measure and threshold, so "oct 1" and
 * "october 1" collapse here exactly as they do at extraction time.
 */
function dedupeItems(items: PrepCounterparty['openItems']): PrepCounterparty['openItems'] {
  const kept: PrepCounterparty['openItems'] = []
  for (const item of items) {
    const duplicate = kept.some(
      (k) =>
        k.side === item.side &&
        commitmentSimilarity(k.what, item.what) >= COMMITMENT_MATCH_THRESHOLD
    )
    if (!duplicate) kept.push(item)
  }
  return kept
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * One meeting, as an email.
 *
 * Written as facts in a fixed order rather than prose, because that is what it
 * is: who, when we last spoke, what is open. A model asked to narrate three
 * facts adds a sentence of connective tissue that costs the reader the glance.
 */
export function renderPrepEmail(prep: MeetingPrep, firstName: string): {
  subject: string
  html: string
} {
  const when = new Date(prep.start).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  })

  const who = prep.counterparties.map((c) => c.name).join(', ')
  const subject = `In ${prep.minutesAway} min: ${prep.subject}${who ? ` — ${who}` : ''}`

  const person = (c: PrepCounterparty) => {
    // Absence is STATED. "Never corresponded" is a different and more useful
    // fact than a blank, which reads as a lookup that failed.
    const contact =
      c.lastContactDays === null
        ? 'never corresponded'
        : c.lastContactDays === 0
          ? 'last spoke today'
          : `last spoke ${c.lastContactDays}d ago`
    const quiet = c.lastContactDays !== null && c.lastContactDays >= STALE_CONTACT_DAYS

    const items = c.openItems
      .map(
        (i) => `
        <li style="font-size:13px;line-height:1.45;color:#111827;margin-bottom:4px;">
          <span style="font-weight:600;">${i.side === 'us' ? 'We owe' : 'They owe'}:</span>
          ${escapeHtml(i.what)}
          <span style="color:#9ca3af;">${i.dueDate ? `· due ${escapeHtml(i.dueDate)}` : '· no date agreed'}</span>
        </li>`
      )
      .join('')

    return `
      <div style="margin-top:14px;">
        <div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(c.name)}</div>
        <div style="font-size:12px;color:${quiet ? '#d97706' : '#6b7280'};margin-top:1px;">
          ${escapeHtml(contact)}${quiet ? ' — gone quiet' : ''}
        </div>
        ${
          items
            ? `<ul style="margin:6px 0 0;padding-left:18px;">${items}</ul>`
            : '<div style="font-size:12px;color:#9ca3af;margin-top:4px;">nothing open with them</div>'
        }
      </div>`
  }

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">
      ${prep.minutesAway} minutes — ${escapeHtml(when)}
    </div>
    <div style="font-size:18px;font-weight:700;margin-top:4px;">${escapeHtml(prep.subject)}</div>
    ${
      prep.location
        ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(prep.location)}</div>`
        : ''
    }
    ${prep.counterparties.map(person).join('')}
    <div style="font-size:11px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">
      Pepper · ${escapeHtml(firstName)}'s calendar. Read out of correspondence already on file.
    </div>
  </div>`

  return { subject, html }
}
