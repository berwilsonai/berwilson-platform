/**
 * Pepper's morning note — gathering, per person.
 *
 * WHY THIS IS NOT THE DAILY DIGEST. The digest is one document about the
 * portfolio, posted to one Chat space. It is genuinely useful and it is
 * addressed to nobody: `team_members` carries no notification preference, and
 * the only per-person channel the platform has ever had is the Monday task
 * digest. This assembles what one named person owes, is owed, and has to decide
 * today — which is a different question from "what happened".
 *
 * WHAT MAKES IT AFFORDABLE, same as the digest: nothing here reads mail. The
 * hourly sweep has already summarized every thread and extracted every
 * commitment, so this reads conclusions and one model call composes them.
 *
 * Per-person attribution is the delicate part and lives in ./attribution — read
 * its header before changing anything about who owns what.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sweepDb } from '@/lib/email-sweep/db'
import { readOpenCommitments, type CommitmentWithMailbox } from '@/lib/commitments/read'
import { fetchCalendarEvents } from '@/lib/integrations/google-workspace'
import { fetchTasksForDigest, type DigestTask } from '@/lib/tasks/queries'
import { summarizeDecideQueue, type DecideSummary } from '@/lib/decide/count'
import { computeAttention, type AttentionItem } from '@/lib/attention'
import type { CommitmentRow } from '@/lib/commitments/db'
import { attribute, loadPepperMembers, type PepperMember } from './attribution'
import { ESCALATE_AFTER, loadMentions, type Mention } from './memory'

/** How many portfolio-level cracks to name. More than this is a report. */
const MAX_CRACKS = 5
/**
 * How many commitments a single section may list.
 *
 * ⚠ MEASURED, not chosen. Eric's ledger alone is 89 owed and 58 awaited, which
 * rendered to an 18,349-character prompt asking for a note under 300 words — a
 * long prefill on a model that serves one request at a time, to produce
 * something the reader could not act on anyway. The overflow count is passed
 * through so the note can say how many it is not showing, which is the
 * difference between a short list and a dishonest one.
 */
const MAX_PER_SECTION = 12
/** A meeting attendee we have not spoken to in this long is worth flagging. */
const STALE_CONTACT_DAYS = 21

export interface MeetingContext {
  subject: string
  start: string
  isAllDay: boolean
  location: string | null
  /** External attendees only — the other executive is not "context". */
  counterparties: {
    name: string
    email: string
    /** Days since the last thread they appear in, or null if never seen. */
    lastContactDays: number | null
    /** Open obligations on threads they are part of, either direction. */
    openItems: { what: string; side: 'us' | 'them' }[]
  }[]
}

/**
 * A commitment with the reason it is on this person's list.
 *
 * `via` is load-bearing for honesty, not decoration: 'name' means extraction
 * named this person, 'mailbox' means it merely landed in their correspondence
 * and the stated owner was somebody else. Rendering both the same way produces
 * lines like "what Richard owes: ... stated owner: Rachel Smith", which is a
 * claim the data does not support.
 */
export interface NoteCommitment {
  row: CommitmentRow
  via: 'name' | 'mailbox'
  /** What Pepper has already said about this one, if anything. */
  mention?: Mention
  /**
   * A one-tap settle link, minted only for a note that is actually being sent.
   * Absent on a dry run — a rehearsal must not leave live credentials behind.
   */
  token?: string | null
}

export interface OvernightWork {
  threadsFiled: number
  commitmentsFound: number
  documentsFiled: number
  leadsScored: number
  /**
   * Meet transcripts read, summarized and staged since the note last ran.
   *
   * ⚠ NOTHING ANYWHERE SAID THIS HAD HAPPENED. The Tensor call of 2026-10-07
   * was imported at 16:22, extracted well — eight follow-ups, the attendees
   * with their emails, the capacity and the priority ranking — and then sat in
   * a 120-row queue with no line in any note. A pass whose failure mode is
   * doing nothing needs a coverage signal (§12), and its SUCCESS deserves one
   * too when the next step is a human's.
   */
  meetingsImported: number
}

export interface PepperNote {
  member: PepperMember
  /** ISO timestamp the note reaches back to. */
  sinceIso: string
  /** Human label for that reach, e.g. "since Friday". */
  sinceLabel: string
  owed: NoteCommitment[]
  awaited: NoteCommitment[]
  /** Obligations that belong to the company rather than one person. */
  sharedOwed: CommitmentRow[]
  sharedAwaited: CommitmentRow[]
  /** How many rows each section had to leave out, so the note can say so. */
  omitted: { owed: number; awaited: number; sharedOwed: number; sharedAwaited: number }
  overdueTasks: DigestTask[]
  dueSoonTasks: DigestTask[]
  meetings: MeetingContext[]
  decide: DecideSummary
  /** Portfolio-level items falling through the cracks, shared by both notes. */
  cracks: AttentionItem[]
  overnight: OvernightWork
  /** Stated out loud so a silent failure never reads as a quiet morning. */
  notes: string[]
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** What makes two cracks "the same thing" for the per-project cap. */
function crackKey(i: AttentionItem): string {
  return `${i.category}:${i.project_id ?? i.project_name}`
}

function daysUntil(date: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`).getTime()
  if (!isFinite(target)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86_400_000)
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

/**
 * How far back the note reaches. Monday reaches over the weekend for the same
 * reason the digest does: a hole nobody can see is worse than a gap they can.
 */
function reach(now: Date): { sinceIso: string; sinceLabel: string } {
  const since = new Date(now)
  const isMonday = now.getDay() === 1
  since.setDate(since.getDate() - (isMonday ? 3 : 1))
  return {
    sinceIso: since.toISOString(),
    sinceLabel: isMonday ? 'since Friday' : 'since yesterday',
  }
}

/** Everything shared between the notes, gathered once rather than per person. */
export interface PepperCommon {
  members: PepperMember[]
  commitments: CommitmentWithMailbox[]
  tasks: DigestTask[]
  decide: DecideSummary
  cracks: AttentionItem[]
  overnight: OvernightWork
  notes: string[]
}

/**
 * Read everything both notes draw on, in one pass.
 *
 * Deliberately not per-person: the commitment ledger, the Decide queue and the
 * attention engine are the same rows for everyone, and querying them once per
 * recipient would trip the single-threaded box for no gain.
 */
export async function assembleCommon(now = new Date()): Promise<PepperCommon> {
  const supabase = createAdminClient()
  const { sinceIso } = reach(now)
  const notes: string[] = []

  const members = await loadPepperMembers(supabase)

  const [commitmentsRes, tasks, decide, attentionItems, overnight] = await Promise.all([
    // ⚠ THROUGH THE CHOKE POINT, NOT A QUERY OF ITS OWN. This read used to be
    // inline here with no confidentiality filter at all, which made a protected
    // project's obligations reachable by an OUTBOUND channel — see the header of
    // src/lib/commitments/read.ts. It also drops rows snoozed past today, which
    // is what lets this note get shorter when somebody works the ledger.
    readOpenCommitments({ excludeSnoozed: true, limit: 500 }),
    fetchTasksForDigest(supabase).catch((err: unknown) => {
      notes.push(`Tasks could not be read: ${err instanceof Error ? err.message : String(err)}`)
      return [] as DigestTask[]
    }),
    summarizeDecideQueue(now.getTime()),
    computeAttention()
      .then((r) => r.items)
      .catch((err: unknown) => {
        notes.push(`The attention engine failed: ${err instanceof Error ? err.message : String(err)}`)
        return [] as AttentionItem[]
      }),
    assembleOvernight(sinceIso),
  ])

  if (commitmentsRes.error) {
    notes.push(`Commitments could not be read: ${commitmentsRes.error}`)
  }

  const commitments = commitmentsRes.rows

  // Overdue tasks are excluded from the cracks list because each person's own
  // overdue tasks already have a section of their own further up the note.
  // Showing them twice is how a note starts getting skimmed.
  //
  // ⚠ And at most two per project per category. Measured on the first real
  // note: all five slots went to the SAME project waiting on the SAME people
  // for the same 143 days — "Response from Governor Cox", "Response from Box
  // Elder Commissioners", "Response regarding the proposal", twice more. Five
  // phrasings of one stalled conversation, and the rest of the portfolio
  // silently lost its place in the note.
  const seen = new Map<string, number>()
  const cracks: AttentionItem[] = []
  for (const item of [...attentionItems]
    .filter((i) => i.category !== 'overdue_action')
    .sort((a, b) => b.urgency - a.urgency)) {
    const key = crackKey(item)
    const n = seen.get(key) ?? 0
    if (n >= 2) continue
    seen.set(key, n + 1)
    cracks.push(item)
    if (cracks.length >= MAX_CRACKS) break
  }

  return { members, commitments, tasks, decide, cracks, overnight, notes }
}

/** What the platform did while nobody was watching. Counts only, all cheap. */
async function assembleOvernight(sinceIso: string): Promise<OvernightWork> {
  const supabase = createAdminClient()
  const sweep = sweepDb()
  const zero: OvernightWork = {
    threadsFiled: 0,
    commitmentsFound: 0,
    documentsFiled: 0,
    leadsScored: 0,
    meetingsImported: 0,
  }
  try {
    const [threads, commitments, documents, leads, meetings] = await Promise.all([
      sweep
        .from('email_threads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso),
      sweep
        .from('commitments')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso),
      supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso),
      sweep
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso)
        .not('status', 'in', '("spam")'),
      // Counted off `meetings` rather than off the intake sessions: the row in
      // `meetings` is the thing the agent can now read, so counting it is
      // counting what actually became available.
      supabase
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .not('drive_file_id', 'is', null)
        .gte('created_at', sinceIso),
    ])
    return {
      threadsFiled: threads.count ?? 0,
      commitmentsFound: commitments.count ?? 0,
      documentsFiled: documents.count ?? 0,
      leadsScored: leads.count ?? 0,
      meetingsImported: meetings.count ?? 0,
    }
  } catch {
    // A missing count costs one line of the note, never the note.
    return zero
  }
}

/**
 * Order a commitment list by how much it should worry someone.
 *
 * Overdue first and most-overdue first within that, then what is due soon, then
 * the undated ones oldest first. Dropping the undated rows would be the easy
 * way to get the list short, and it would hide most of what a real ledger
 * contains — 185 of the 220 open rows carry no agreed date at all.
 */
/**
 * Bands, highest first. A row never crosses a band for the sake of variety —
 * a deadline is a fact about the world.
 *
 *   10,000+  overdue, most overdue first
 *    5,000+  dated, soonest first
 *    2,000+  UNDATED AND NEVER NAMED — the obligations no note ever reached
 *      0-400 undated and named, longest-since-named first
 *
 * `age / 1000` is a sub-unit tiebreaker, so within a band the older row wins
 * without ever reaching the band above.
 *
 * ⚠ AND THE BANDS ROTATE INTERNALLY, WHICH THE FIRST VERSION OF THIS DID NOT.
 * Rotating only the undated tail was measured and found INERT: Richard carries
 * 27 overdue commitments on the owed side against a cap of 12, so the undated
 * band is never reached and the top twelve were identical every morning — the
 * original defect, surviving one band up. `recentPenalty` is what fixes it.
 */
function commitmentWeight(c: CommitmentRow, mentions?: Map<string, Mention>): number {
  const m = mentions?.get(c.id)
  const due = c.due_date ? daysUntil(c.due_date) : null
  // Overdue: the further past, the heavier. Bounded so a 225-day-old item does
  // not permanently outrank everything that is merely due tomorrow.
  if (due !== null && due < 0) return 10_000 + Math.min(-due, 400) - recentPenalty(m)
  if (due !== null) return 5_000 - Math.min(due, 400) - recentPenalty(m)

  const age = Math.min(daysSince(c.created_at) ?? 0, 400)
  // Never named beats everything else undated. With 369 undated rows and a cap
  // of 12 a note that always picked the oldest would show the same twelve until
  // somebody settled one — which, measured over eleven mornings, nobody did.
  if (!m) return 2_000 + age / 1000
  return Math.min(m.daysSinceNamed ?? 0, 400) + age / 1000
}

/**
 * How far a row steps aside for having just been shown.
 *
 * ⚠ THE SNOOZE IS WHAT MAKES THIS LEGITIMATE. An earlier draft of this module
 * argued the mention count must never demote anything, because a thing ignored
 * five times may be ignored for a good reason and burying it would be the
 * platform silently overruling a person. That was right WHEN THE READER HAD NO
 * WAY TO SAY "not today" — with `snoozed_until` they do, and it is one tap in
 * the note itself. So a reader who keeps not acting and keeps not quieting is
 * not being overruled by a row moving down two places for one morning.
 *
 * BOUNDED AT 50, WELL UNDER THE 400 OF WITHIN-BAND SPREAD AND NOWHERE NEAR THE
 * 5,000 BETWEEN BANDS. It nudges; it cannot hide. And it EXPIRES after two days
 * of not being named, so anything displaced returns to the top on its own — the
 * rotation is self-correcting rather than a decay that buries things.
 *
 * ⚠ AND IT STOPS AT THE ESCALATION BAR, WHICH THE FIRST VERSION DID NOT. Found
 * by running it: with an unbounded-by-count penalty the items on their fourth
 * and fifth mention were the ones pushed hardest out of the note — so the
 * escalation clause, which exists precisely to say "this is the fourth morning
 * I have raised this", was suppressed on exactly the rows that had earned it.
 * The two features were cancelling. An item that has been raised three times
 * has stopped being ordinary backlog: the rotation lets it go, it holds its
 * place, and the reader's way out is the snooze rather than the queue shuffling
 * it off on their behalf.
 */
function recentPenalty(m: Mention | undefined): number {
  if (!m || m.daysSinceNamed === null || m.daysSinceNamed > 2) return 0
  if (m.timesNamed >= ESCALATE_AFTER) return 0
  return m.timesNamed * 25
}

function rankRows(rows: CommitmentRow[], mentions?: Map<string, Mention>): CommitmentRow[] {
  return [...rows].sort((a, b) => commitmentWeight(b, mentions) - commitmentWeight(a, mentions))
}

function rank(items: NoteCommitment[], mentions?: Map<string, Mention>): NoteCommitment[] {
  return [...items].sort(
    (a, b) => commitmentWeight(b.row, mentions) - commitmentWeight(a.row, mentions)
  )
}

/**
 * The part of the morning that is only true for one person: their share of the
 * ledger, their tasks, and their calendar read from their own mailbox.
 */
export async function assembleForMember(
  member: PepperMember,
  common: PepperCommon,
  now = new Date()
): Promise<PepperNote> {
  const { sinceIso, sinceLabel } = reach(now)
  const notes = [...common.notes]
  const horizon = daysFromNow(7)

  // What Pepper has already said to THIS person. Per-member by definition —
  // "the fourth morning" is only true of the reader who saw the other three.
  const mentions = await loadMentions(member.id, 'commitment')

  const mine: NoteCommitment[] = []
  const shared: CommitmentRow[] = []
  for (const c of common.commitments) {
    const a = attribute(c.owner_name, c.mailbox, common.members, c.side)
    if (a.kind === 'member') {
      if (a.memberId === member.id) {
        mine.push({ row: c, via: a.via, mention: mentions.get(c.id) })
      }
    } else {
      shared.push(c)
    }
  }

  // Dated inside the horizon plus every undated one. An obligation with no
  // agreed date is not less real; it just cannot be sorted by one.
  const near = (c: CommitmentRow) => !c.due_date || c.due_date <= horizon

  const today = now.toISOString().slice(0, 10)
  const in7 = daysFromNow(7)
  const myTasks = common.tasks.filter((t) => t.assignee_id === member.id && t.due_date)

  const meetings = await assembleMeetings(member, now, notes)

  const owed = rank(mine.filter((c) => c.row.side === 'us' && near(c.row)), mentions)
  const awaited = rank(mine.filter((c) => c.row.side === 'them' && near(c.row)), mentions)
  const sharedOwed = rankRows(shared.filter((c) => c.side === 'us' && near(c)), mentions)
  const sharedAwaited = rankRows(shared.filter((c) => c.side === 'them' && near(c)), mentions)

  return {
    member,
    sinceIso,
    sinceLabel,
    owed: owed.slice(0, MAX_PER_SECTION),
    awaited: awaited.slice(0, MAX_PER_SECTION),
    sharedOwed: sharedOwed.slice(0, MAX_PER_SECTION),
    sharedAwaited: sharedAwaited.slice(0, MAX_PER_SECTION),
    omitted: {
      owed: Math.max(0, owed.length - MAX_PER_SECTION),
      awaited: Math.max(0, awaited.length - MAX_PER_SECTION),
      sharedOwed: Math.max(0, sharedOwed.length - MAX_PER_SECTION),
      sharedAwaited: Math.max(0, sharedAwaited.length - MAX_PER_SECTION),
    },
    overdueTasks: myTasks.filter((t) => t.due_date! < today),
    dueSoonTasks: myTasks.filter((t) => t.due_date! >= today && t.due_date! <= in7),
    meetings,
    decide: common.decide,
    cracks: common.cracks,
    overnight: common.overnight,
    notes,
  }
}

/**
 * Today's meetings from this person's OWN calendar, with the counterparty
 * context an assistant would have looked up before the meeting.
 *
 * Best-effort throughout: a Google outage costs the meetings block and says so,
 * because silence here is indistinguishable from an empty calendar.
 */
async function assembleMeetings(
  member: PepperMember,
  now: Date,
  notes: string[]
): Promise<MeetingContext[]> {
  let events
  try {
    const dayEnd = new Date(now)
    dayEnd.setHours(23, 59, 59, 999)
    events = await fetchCalendarEvents(now.toISOString(), dayEnd.toISOString(), member.mailbox)
  } catch (err) {
    notes.push(
      `Calendar unavailable, so today's meetings are missing: ${err instanceof Error ? err.message : String(err)}`
    )
    return []
  }

  const internal = new Set(member.email.split('@')[1] ? [member.email] : [])
  const upcoming = events.slice(0, 8)

  // Every external address across every meeting, resolved in ONE pass rather
  // than a query per attendee.
  const emails = [
    ...new Set(
      upcoming
        .flatMap((e) => e.attendees.map((a) => a.email.toLowerCase()))
        .filter((e) => e && !internal.has(e))
    ),
  ]

  const context = await counterpartyContext(emails)

  return upcoming.map((e) => ({
    subject: e.subject,
    start: e.start,
    isAllDay: e.isAllDay,
    location: e.location,
    counterparties: e.attendees
      .filter((a) => !internal.has(a.email.toLowerCase()))
      .slice(0, 6)
      .map((a) => {
        const ctx = context.get(a.email.toLowerCase())
        return {
          name: a.name || a.email,
          email: a.email,
          lastContactDays: ctx?.lastContactDays ?? null,
          openItems: ctx?.openItems ?? [],
        }
      }),
  }))
}

/** Last contact and open obligations for a set of addresses, in two queries. */
async function counterpartyContext(
  emails: string[]
): Promise<Map<string, { lastContactDays: number | null; openItems: { what: string; side: 'us' | 'them' }[] }>> {
  const out = new Map<string, { lastContactDays: number | null; openItems: { what: string; side: 'us' | 'them' }[] }>()
  if (emails.length === 0) return out

  const sweep = sweepDb()
  try {
    const { data: threads } = await sweep
      .from('email_threads')
      .select('id, participants, last_at')
      .overlaps('participants', emails)
      .order('last_at', { ascending: false })
      .limit(200)

    const rows = (threads ?? []) as { id: string; participants: string[]; last_at: string | null }[]
    if (rows.length === 0) return out

    const { data: items } = await sweep
      .from('commitments')
      .select('thread_id, what, side')
      .eq('status', 'open')
      .in(
        'thread_id',
        rows.map((r) => r.id)
      )
      .limit(200)

    const byThread = new Map<string, { what: string; side: 'us' | 'them' }[]>()
    for (const i of (items ?? []) as { thread_id: string; what: string; side: 'us' | 'them' }[]) {
      const list = byThread.get(i.thread_id) ?? []
      list.push({ what: i.what, side: i.side })
      byThread.set(i.thread_id, list)
    }

    for (const email of emails) {
      const theirs = rows.filter((r) => (r.participants ?? []).some((p) => p.toLowerCase() === email))
      if (theirs.length === 0) continue
      const newest = theirs[0].last_at
      const open: { what: string; side: 'us' | 'them' }[] = []
      for (const t of theirs) for (const c of byThread.get(t.id) ?? []) open.push(c)
      out.set(email, { lastContactDays: daysSince(newest), openItems: open.slice(0, 4) })
    }
  } catch {
    // Context is a courtesy; the meeting line stands without it.
  }
  return out
}

/**
 * True when this person has nothing to hear. A note that arrives every morning
 * saying "nothing today" is the fastest way to teach someone to filter it.
 */
export function noteIsEmpty(n: PepperNote): boolean {
  return (
    n.owed.length === 0 &&
    n.awaited.length === 0 &&
    n.overdueTasks.length === 0 &&
    n.dueSoonTasks.length === 0 &&
    n.meetings.length === 0 &&
    n.cracks.length === 0 &&
    n.decide.total === 0
  )
}

export { STALE_CONTACT_DAYS }
