/**
 * Daily digest — the morning read.
 *
 * WHAT MAKES THIS AFFORDABLE. Every email has already been read, triaged and
 * summarized by the hourly sweep, so the digest does not read mail: it reads
 * conclusions. One model call composes the whole thing, rather than one call per
 * message. Measured on live data, a normal weekday produces 3-13 substantive
 * threads out of 50-90 — the rest is marketing the filters already discarded —
 * so the input to that single call is small.
 *
 * WHAT GOES IN IT, and why the deadline half exists. Measured before building:
 * BI held zero milestones with a future date, zero projects with a bid due date,
 * and nine open tasks with a due date. A digest built on the platform's own
 * dated records would have had almost nothing to say. The dates are real but
 * they live in correspondence, which is why commitments are extracted and lead
 * bid dates are pulled in alongside them.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sweepDb } from '@/lib/email-sweep/db'
import { fetchCalendarEvents } from '@/lib/integrations/google-workspace'
import { summarizeDecideQueue } from '@/lib/decide/count'
import type { CommitmentRow } from '@/lib/commitments/db'

/** Commitments this far ahead count as "coming up" rather than "later". */
const COMMITMENT_HORIZON_DAYS = 7
/** A bid closing inside this window is urgent enough to name in the digest. */
const BID_HORIZON_DAYS = 14

export interface DigestWindow {
  sinceIso: string
  untilIso: string
  /** Human label for the period covered, e.g. "since Friday". */
  label: string
}

/**
 * The period the digest covers.
 *
 * Monday reaches back over the weekend. Without that, everything that arrived
 * Friday evening through Sunday would be silently skipped — and a digest with a
 * hole in it is worse than no digest, because nobody can see the hole.
 */
export function digestWindow(now = new Date()): DigestWindow {
  const until = new Date(now)
  const since = new Date(now)
  const isMonday = now.getDay() === 1
  since.setDate(since.getDate() - (isMonday ? 3 : 1))
  return {
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    label: isMonday ? 'since Friday' : 'in the last 24 hours',
  }
}

export interface DigestData {
  window: DigestWindow
  threads: { subject: string; summary: string; dealName: string | null; counterparty: string | null; relevance: string; keyFacts: string[] }[]
  leads: { title: string; company: string | null; bidDue: string | null; score: number | null; recommendation: string | null }[]
  commitmentsOwed: CommitmentRow[]
  commitmentsAwaited: CommitmentRow[]
  bidsClosing: { title: string; bidDue: string; company: string | null }[]
  tasksDue: { title: string; dueDate: string; assignee: string | null }[]
  meetings: { subject: string; start: string; attendees: number }[]
  decide: { total: number; leads: number; intake: number; review: number }
  /** Stated out loud so a silent failure never reads as a quiet day. */
  notes: string[]
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function assembleDigest(now = new Date()): Promise<DigestData> {
  const window = digestWindow(now)
  const supabase = createAdminClient()
  const sweep = sweepDb()
  const today = now.toISOString().slice(0, 10)
  const notes: string[] = []

  const [
    threadsRes,
    leadsRes,
    commitmentsRes,
    bidsRes,
    tasksRes,
    decide,
  ] = await Promise.all([
    // Substantive deal-mailbox correspondence only. `noise` is excluded here
    // rather than shown and ignored: the filter is auditable on /decide and in
    // Gmail labels, and 40-70 lines of marketing a day is exactly what stops a
    // digest from being read.
    sweep
      .from('email_threads')
      .select('subject, summary, last_at')
      .eq('pipeline', 'deal')
      .eq('summary_state', 'summarized')
      .gte('last_at', window.sinceIso)
      .order('last_at', { ascending: false })
      .limit(40),

    // Newly scored bid invitations from the lead mailbox. A dated invitation is
    // precisely what an assistant should surface, and these already carry a
    // score and a deadline.
    sweep
      .from('leads')
      .select('title, sender_company, bid_due_date, fit_score, fit_recommendation, created_at, status')
      .gte('created_at', window.sinceIso)
      .not('status', 'in', '("spam","ignored","expired")')
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(20),

    sweep
      .from('commitments')
      .select('*')
      .eq('status', 'open')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(60),

    sweep
      .from('leads')
      .select('title, sender_company, bid_due_date')
      .in('status', ['new', 'reviewing'])
      .gte('bid_due_date', today)
      .lte('bid_due_date', daysFromNow(BID_HORIZON_DAYS))
      .order('bid_due_date', { ascending: true })
      .limit(15),

    supabase
      .from('tasks')
      .select('title, due_date, assignee:team_members!tasks_assignee_id_fkey(name)')
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lte('due_date', daysFromNow(COMMITMENT_HORIZON_DAYS))
      .order('due_date', { ascending: true })
      .limit(20),

    summarizeDecideQueue(now.getTime()),
  ])

  if (threadsRes.error) notes.push(`Correspondence could not be read: ${threadsRes.error.message}`)
  if (commitmentsRes.error) notes.push(`Commitments could not be read: ${commitmentsRes.error.message}`)

  const threadRows = (threadsRes.data ?? []) as { subject: string | null; summary: unknown }[]
  const threads = threadRows
    .map((t) => {
      const s = (t.summary ?? {}) as Record<string, unknown>
      return {
        subject: t.subject ?? '(no subject)',
        summary: typeof s.summary === 'string' ? s.summary : '',
        dealName: typeof s.deal_name === 'string' ? s.deal_name : null,
        counterparty: typeof s.counterparty === 'string' ? s.counterparty : null,
        relevance: typeof s.relevance === 'string' ? s.relevance : 'noise',
        keyFacts: Array.isArray(s.key_facts)
          ? (s.key_facts as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 4)
          : [],
      }
    })
    .filter((t) => t.relevance === 'deal' || t.relevance === 'operational')

  const commitments = (commitmentsRes.data ?? []) as CommitmentRow[]
  const horizon = daysFromNow(COMMITMENT_HORIZON_DAYS)
  // Dated commitments inside the horizon, plus undated ones — an obligation
  // with no agreed date is not less real, it just cannot be sorted by one, and
  // dropping those would hide most of what a real inbox contains.
  const relevant = commitments.filter((c) => !c.due_date || c.due_date <= horizon)

  // Calendar is best-effort: a Google outage must cost the meetings block, not
  // the digest. Silence here would be indistinguishable from an empty calendar,
  // so a failure is written into notes and says so in the output.
  let meetings: DigestData['meetings'] = []
  try {
    const dayEnd = new Date(now)
    dayEnd.setHours(23, 59, 59, 999)
    const events = await fetchCalendarEvents(now.toISOString(), dayEnd.toISOString())
    meetings = events.slice(0, 10).map((e) => ({
      subject: e.subject,
      start: e.start,
      attendees: e.attendees?.length ?? 0,
    }))
  } catch (err) {
    notes.push(
      `Calendar unavailable, so today's meetings are missing: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const taskRows = (tasksRes.data ?? []) as {
    title: string
    due_date: string
    assignee: { name: string } | { name: string }[] | null
  }[]

  return {
    window,
    threads,
    leads: ((leadsRes.data ?? []) as Record<string, unknown>[]).map((l) => ({
      title: String(l.title ?? '(untitled)'),
      company: (l.sender_company as string) ?? null,
      bidDue: (l.bid_due_date as string) ?? null,
      score: (l.fit_score as number) ?? null,
      recommendation: (l.fit_recommendation as string) ?? null,
    })),
    commitmentsOwed: relevant.filter((c) => c.side === 'us'),
    commitmentsAwaited: relevant.filter((c) => c.side === 'them'),
    bidsClosing: ((bidsRes.data ?? []) as Record<string, unknown>[]).map((b) => ({
      title: String(b.title ?? '(untitled)'),
      bidDue: String(b.bid_due_date),
      company: (b.sender_company as string) ?? null,
    })),
    tasksDue: taskRows.map((t) => ({
      title: t.title,
      dueDate: t.due_date,
      assignee: Array.isArray(t.assignee) ? (t.assignee[0]?.name ?? null) : (t.assignee?.name ?? null),
    })),
    meetings,
    decide: { total: decide.total, leads: decide.leads, intake: decide.intake, review: decide.review },
    notes,
  }
}

/** True when there is genuinely nothing to report — a real and valid outcome. */
export function digestIsEmpty(d: DigestData): boolean {
  return (
    d.threads.length === 0 &&
    d.leads.length === 0 &&
    d.commitmentsOwed.length === 0 &&
    d.commitmentsAwaited.length === 0 &&
    d.bidsClosing.length === 0 &&
    d.tasksDue.length === 0 &&
    d.meetings.length === 0
  )
}
