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
import { countRetiredSince } from '@/lib/commitments/aging'
import {
  readOpenProposals,
  readPepperChanges,
  type CuratedChange,
  type OpenProposal,
} from '@/lib/provenance/report'
import { fetchCalendarEvents } from '@/lib/integrations/google-workspace'
import { fetchTasksForDigest, type DigestTask } from '@/lib/tasks/queries'
import { loadLiveContext, taskTier, EMPTY_LIVE_CONTEXT, type LiveContext } from '@/lib/tasks/priority'
import { summarizeDecideQueue, type DecideSummary } from '@/lib/decide/count'
import { computeAttention, type AttentionItem } from '@/lib/attention'
import type { CommitmentRow } from '@/lib/commitments/db'
import {
  attribute,
  internalSet,
  isExternalTo,
  loadPepperMembers,
  type PepperMember,
} from './attribution'
import { ESCALATE_AFTER, arrivedSince, loadMentions, type Mention } from './memory'

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
/**
 * How many ARRIVALS a section may carry beyond its cap.
 *
 * ⚠ WITHOUT THIS, "NEW SINCE THE LAST NOTE" IS A HEADING THAT IS USUALLY EMPTY.
 * Measured 2026-10-29: 13 commitments arrived in 24 hours and exactly **2**
 * survived into the rendered note. `rank()` orders by `commitmentWeight` — due
 * date and overdue days — so a brand-new UNDATED obligation sorts near the
 * bottom and is cut by `MAX_PER_SECTION` before the reader ever sees it. The
 * one genuinely new thing in a daily note was the thing most likely to be
 * dropped from it.
 *
 * So arrivals are admitted ON TOP of the ranked twelve rather than competing
 * with them: the existing order is untouched (a deadline is a real fact and
 * must not be shuffled for variety — see memory.ts), and the overflow count
 * still reports whatever neither pass showed. Bounded, because a day on which
 * forty obligations land must not produce a fifty-line prompt asking for 300
 * words.
 */
const MAX_ARRIVALS_PER_SECTION = 6

/**
 * The ranked top of a section, plus any arrival the cap would have cut.
 *
 * ⚠ ORDER IS PRESERVED, NOT RECOMPUTED. The admitted arrivals keep their
 * relative rank and follow the ranked twelve; the renderer marks them and the
 * prompt lifts them into their own section, so the reader sees them at the top
 * of the note whatever position they hold in this array.
 */
function withArrivals<T>(
  ranked: T[],
  sinceIso: string,
  // ⚠ AN ACCESSOR, BECAUSE THE FOUR SECTIONS ARE TWO SHAPES. The per-person
  // sections carry `NoteCommitment` wrappers (they need `via` and `mention`)
  // and the shared ones carry bare `CommitmentRow`s. One helper with a getter
  // rather than two near-identical copies — §12: never fork a shared pass.
  getRow: (item: T) => CommitmentRow
): { shown: T[]; omitted: number } {
  const head = ranked.slice(0, MAX_PER_SECTION)
  const extra = ranked
    .slice(MAX_PER_SECTION)
    .filter((c) => arrivedSince(getRow(c).created_at, sinceIso))
    .slice(0, MAX_ARRIVALS_PER_SECTION)
  const shown = [...head, ...extra]
  // ⚠ DERIVED FROM WHAT WAS ACTUALLY SHOWN, never `length - MAX_PER_SECTION`.
  // §12: withholding from a reader means handing them the count, and a count
  // that ignores the arrivals admitted above would overstate by up to six.
  return { shown, omitted: Math.max(0, ranked.length - shown.length) }
}
/** A meeting attendee we have not spoken to in this long is worth flagging. */
const STALE_CONTACT_DAYS = 21
/** How many of today's meetings carry counterparty context. One day's worth. */
const MAX_MEETINGS_TODAY = 8
/** How many the week-ahead text may draw on. A week of a busy calendar. */
const MAX_MEETINGS_WEEK = 40

/**
 * Today, as the calendar feed spells it.
 *
 * ⚠ LOCAL, NOT `toISOString().slice(0, 10)`. Google returns a local-time stamp
 * for a timed event, so comparing it against a UTC date key puts every meeting
 * after 5pm Mountain on tomorrow — and `weekMeetings` would then disagree with
 * `meetings` about which day today is.
 */
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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
  /**
   * Obligations the aging pass retired because their conversation is over.
   *
   * ⚠ THE ONE NUMBER IN THIS BLOCK THAT GOES DOWN, AND IT MUST BE SAID OUT
   * LOUD. The pass closes rows with nobody approving it, which is defensible
   * only while the reader is told: §11 traded the approval gate for
   * legibility, not for silence. A ledger that shrank overnight with no line
   * explaining why is the platform quietly deciding something stopped
   * mattering.
   */
  commitmentsRetired: number
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
  /**
   * Open work on a live deal that carries no near deadline.
   *
   * ⚠ THE SECTION THAT HAD TO EXIST BEFORE ANY OF THIS WAS WORTH DOING. The
   * note listed overdue and due-in-7 and nothing else, so a task with no due
   * date was never mentioned — and 34 of the 38 obligations promoted off the
   * executives' own correspondence on 2026-10-12 have no date. "Finalize the
   * Fairbanks Mining Contract" is not less real for having no deadline, which
   * is the same sentence already written above `near()` about commitments and
   * never applied to tasks.
   */
  liveTasks: DigestTask[]
  /**
   * What Pepper has already said about each TASK, by task id.
   *
   * ⚠ THESE ROWS WERE WRITTEN EVERY MORNING AND READ BY NOBODY. The note has
   * recorded a `kind='task'` mention after every successful send since 10-09,
   * and `loadMentions` was only ever called with `'commitment'` — so a task
   * raised four mornings running got no escalation clause while a commitment
   * beside it did. The write was already there; this is the read.
   */
  taskMentions: Map<string, Mention>
  meetings: MeetingContext[]
  /**
   * Every timed meeting and all-day marker in the next seven days, WITHOUT
   * counterparty context — the Monday week-ahead text names subjects and days
   * and nothing else, so resolving attendees for a whole week would be a lot of
   * queries for a line nobody reads.
   *
   * ⚠ THIS FIELD EXISTS BECAUSE THE WEEK-AHEAD TEXT WAS STRUCTURALLY INCAPABLE
   * OF NAMING A MEETING AFTER MONDAY. `composeWeekAheadText` filtered a 7-day
   * window over `meetings`, which `assembleMeetings` only ever filled with
   * TODAY — so "3 meetings this week" could only ever count Monday's, and the
   * `weekdayOf()` formatter beside it had nothing but Mondays to format. Its
   * test passed throughout because the fixture injects a Tuesday meeting
   * directly into `meetings`, bypassing the one-day fetch. §12: a cap or a
   * window sized for one caller is wrong for the sibling that shares the field.
   */
  weekMeetings: MeetingContext[]
  decide: DecideSummary
  /** Portfolio-level items falling through the cracks, shared by both notes. */
  cracks: AttentionItem[]
  overnight: OvernightWork
  /**
   * Pepper's own CRM writes and the questions she is holding.
   *
   * ⚠ THIS IS WHAT MAKES §11's TRADE SOUND. Richard's 10-12 direction removed
   * the approval gate for updates in exchange for every change being reported
   * each morning — and the reporting half was never built, so she had been
   * writing to records unattended with no line anywhere saying what she did.
   */
  curation: Curation
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

/**
 * What Pepper changed in the CRM by herself, and what she will not change
 * without being told.
 *
 * ⚠ SHARED, NOT PER-PERSON. A field on a deal record belongs to the company;
 * attributing it to whoever happens to be reading would be inventing an owner.
 * Both notes carry the same block, the way `cracks` already does.
 */
export interface Curation {
  changes: CuratedChange[]
  proposals: OpenProposal[]
  /** The true pending total, which the list above is capped below. */
  proposalsTotal: number
  /**
   * Contacts Pepper ADDED, which is a different event from a field she filled.
   *
   * ⚠ READ FROM `parties`, NOT FROM `record_field_provenance`. A creation is
   * not a field write, so the provenance table — which is what
   * `readPepperChanges` reads — cannot see one. The `auto-contact` tag is the
   * structural record of "this row exists because she made it", and it is also
   * the handle for undoing a whole run.
   */
  contactsAdded: { name: string; company: string | null }[]
  /** The true total added in the window, which the list above is capped below. */
  contactsAddedTotal: number
}

/** Everything shared between the notes, gathered once rather than per person. */
export interface PepperCommon {
  members: PepperMember[]
  commitments: CommitmentWithMailbox[]
  tasks: DigestTask[]
  /** Which deals and conversations have moved lately, for tiering those tasks. */
  live: LiveContext
  decide: DecideSummary
  cracks: AttentionItem[]
  overnight: OvernightWork
  curation: Curation
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

  const [commitmentsRes, tasks, decide, attentionItems, overnight, live, curation] =
    await Promise.all([
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
    // A failed read falls back to date-only bucketing rather than failing the
    // note, and says so — §12: withholding from a reader means telling them.
    loadLiveContext(now).catch((err: unknown) => {
      notes.push(
        `Could not tell which deals are active: ${err instanceof Error ? err.message : String(err)}`
      )
      return { ...EMPTY_LIVE_CONTEXT, error: null }
    }),
    assembleCuration(sinceIso, notes),
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

  if (live.error) notes.push(`Could not tell which deals are active: ${live.error}`)

  return { members, commitments, tasks, live, decide, cracks, overnight, curation, notes }
}

/**
 * Pepper's own writes and her open questions.
 *
 * Degrades like everything else here: a failed read costs the block and SAYS
 * so, because silence about what she changed is the one failure this section
 * exists to prevent.
 */
async function assembleCuration(sinceIso: string, notes: string[]): Promise<Curation> {
  const empty: Curation = {
    changes: [],
    proposals: [],
    proposalsTotal: 0,
    contactsAdded: [],
    contactsAddedTotal: 0,
  }
  try {
    const [changes, proposals, added] = await Promise.all([
      readPepperChanges(sinceIso),
      readOpenProposals(),
      createAdminClient()
        .from('parties')
        .select('full_name, company', { count: 'exact' })
        .contains('tags', ['auto-contact'])
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(MAX_PER_SECTION),
    ])
    if (changes.error) {
      notes.push(`I could not read back what I changed in the CRM: ${changes.error}`)
    }
    if (proposals.error) {
      notes.push(`I could not read the fields I am waiting to ask you about: ${proposals.error}`)
    }
    if (added.error) {
      notes.push(`I could not read back the contacts I added: ${added.error.message}`)
    }
    return {
      changes: changes.changes,
      proposals: proposals.proposals,
      proposalsTotal: proposals.total,
      contactsAdded: ((added.data ?? []) as { full_name: string; company: string | null }[]).map(
        (r) => ({ name: r.full_name, company: r.company })
      ),
      contactsAddedTotal: added.count ?? 0,
    }
  } catch (err) {
    notes.push(
      `I could not read back my own CRM changes: ${err instanceof Error ? err.message : String(err)}`
    )
    return empty
  }
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
    commitmentsRetired: 0,
  }
  try {
    const [threads, commitments, documents, leads, meetings, retired] = await Promise.all([
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
      countRetiredSince(sinceIso),
    ])
    return {
      threadsFiled: threads.count ?? 0,
      commitmentsFound: commitments.count ?? 0,
      documentsFiled: documents.count ?? 0,
      leadsScored: leads.count ?? 0,
      meetingsImported: meetings.count ?? 0,
      commitmentsRetired: retired,
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
  // ⚠ `previousMornings`, NOT `timesNamed`, for the same reason the clause uses
  // it: the 06:45 text records what it named, so today may already be counted
  // by the time this runs and a row would step aside one band harder on the
  // strength of having been shown an hour ago. See `Mention`.
  if (m.previousMornings >= ESCALATE_AFTER) return 0
  return m.previousMornings * 25
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
  // Both kinds in one round trip; the table is indexed on (member, kind).
  const [mentions, taskMentions] = await Promise.all([
    loadMentions(member.id, 'commitment'),
    loadMentions(member.id, 'task'),
  ])

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
  const myTasks = common.tasks.filter((t) => t.assignee_id === member.id)

  const { today: meetings, week: weekMeetings } = await assembleMeetings(
    member,
    common.members,
    now,
    notes
  )

  const owed = rank(mine.filter((c) => c.row.side === 'us' && near(c.row)), mentions)
  const awaited = rank(mine.filter((c) => c.row.side === 'them' && near(c.row)), mentions)
  const sharedOwed = rankRows(shared.filter((c) => c.side === 'us' && near(c)), mentions)
  const sharedAwaited = rankRows(shared.filter((c) => c.side === 'them' && near(c)), mentions)

  // Each section: the ranked twelve, plus any arrival the cap would have cut.
  const owedShown = withArrivals(owed, sinceIso, (c) => c.row)
  const awaitedShown = withArrivals(awaited, sinceIso, (c) => c.row)
  const sharedOwedShown = withArrivals(sharedOwed, sinceIso, (c) => c)
  const sharedAwaitedShown = withArrivals(sharedAwaited, sinceIso, (c) => c)

  return {
    member,
    sinceIso,
    sinceLabel,
    owed: owedShown.shown,
    awaited: awaitedShown.shown,
    sharedOwed: sharedOwedShown.shown,
    sharedAwaited: sharedAwaitedShown.shown,
    omitted: {
      owed: owedShown.omitted,
      awaited: awaitedShown.omitted,
      sharedOwed: sharedOwedShown.omitted,
      sharedAwaited: sharedAwaitedShown.omitted,
    },
    overdueTasks: myTasks.filter((t) => t.due_date && t.due_date < today),
    dueSoonTasks: myTasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in7),
    // What is left: no deadline, or one past the horizon. Only the LIVE tier is
    // named — a task on a deal nobody has written about in a fortnight belongs
    // on the board, not in a morning note that has to stay under 300 words. The
    // same window and the same function the board and the sheet rank by, so the
    // note cannot disagree with either about what is active.
    liveTasks: myTasks.filter(
      (t) =>
        (!t.due_date || t.due_date > in7) && taskTier(t, common.live) === 'live'
    ),
    taskMentions,
    meetings,
    weekMeetings,
    decide: common.decide,
    cracks: common.cracks,
    overnight: common.overnight,
    curation: common.curation,
    notes,
  }
}

/**
 * This person's OWN calendar, with the counterparty context an assistant would
 * have looked up before the meeting.
 *
 * ⚠ ONE FETCH, TWO HORIZONS. The week is read because the Monday text needs it
 * (see `PepperNote.weekMeetings`); the counterparty resolution is confined to
 * TODAY because that is the only block that prints a counterparty, and
 * resolving a week of attendees would be a query storm for nothing.
 *
 * Best-effort throughout: a Google outage costs the meetings block and says so,
 * because silence here is indistinguishable from an empty calendar.
 */
async function assembleMeetings(
  member: PepperMember,
  members: PepperMember[],
  now: Date,
  notes: string[]
): Promise<{ today: MeetingContext[]; week: MeetingContext[] }> {
  let events
  try {
    const weekEnd = new Date(now)
    weekEnd.setDate(weekEnd.getDate() + 7)
    weekEnd.setHours(23, 59, 59, 999)
    events = await fetchCalendarEvents(now.toISOString(), weekEnd.toISOString(), member.mailbox)
  } catch (err) {
    notes.push(
      `Calendar unavailable, so today's meetings are missing: ${err instanceof Error ? err.message : String(err)}`
    )
    return { today: [], week: [] }
  }

  // ⚠ FROM THE ROSTER, NOT FROM ONE ADDRESS. This was
  // `new Set([member.email])`, which made the morning note call the other
  // executive an external counterparty and recite his open commitments back —
  // the exact bug `meeting-prep.ts` was fixed for on 2026-10-09, in the module
  // that assembles this note five minutes earlier. See `internalSet`.
  const internal = internalSet(members)
  const isExternal = (email: string) => isExternalTo(internal, email)

  const todayKey = localDateKey(now)
  const todaysEvents = events.filter((e) => e.start.slice(0, 10) === todayKey).slice(0, MAX_MEETINGS_TODAY)

  // Every external address across TODAY's meetings, resolved in ONE pass rather
  // than a query per attendee.
  const emails = [
    ...new Set(
      todaysEvents.flatMap((e) => e.attendees.map((a) => a.email.toLowerCase())).filter(isExternal)
    ),
  ]

  const context = await counterpartyContext(emails)

  const today = todaysEvents.map((e) => ({
    subject: e.subject,
    start: e.start,
    isAllDay: e.isAllDay,
    location: e.location,
    counterparties: e.attendees
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
      }),
  }))

  // The week, bare. Counterparties are deliberately empty rather than absent:
  // the field is required by the type and an empty list is the honest answer to
  // "who is in it" when nobody asked.
  const week = events.slice(0, MAX_MEETINGS_WEEK).map((e) => ({
    subject: e.subject,
    start: e.start,
    isAllDay: e.isAllDay,
    location: e.location,
    counterparties: [],
  }))

  return { today, week }
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

    // ⚠ THROUGH THE CHOKE POINT. This was a direct read until 2026-10-11 — its
    // sibling in `meeting-prep.ts` was converted on 10-09 and this copy was
    // missed, so a protected deal's obligations could reach the SENT note by way
    // of a counterparty who also appears on an unprotected thread.
    const { rows: items } = await readOpenCommitments({
      threadIds: rows.map((r) => r.id),
      limit: 200,
    })

    const byThread = new Map<string, { what: string; side: 'us' | 'them' }[]>()
    for (const i of items) {
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
 *
 * ⚠ WHAT PEPPER DID TO THE CRM COUNTS AS SOMETHING TO HEAR. This tested only
 * the reader's own work — obligations, tasks, meetings, cracks, the queue — so
 * a morning whose only news was that she had changed records or added contacts
 * sent NO NOTE, and the change went unreported. The whole safety argument for
 * writing to the CRM unattended is that every change is reported in this note
 * (§11, and the header of `curator/run.ts`): a quiet morning must not be able
 * to swallow it. Her questions count too — an unanswered proposal is a thing
 * she is waiting on the reader for.
 */
export function noteIsEmpty(n: PepperNote): boolean {
  return (
    n.owed.length === 0 &&
    n.awaited.length === 0 &&
    n.overdueTasks.length === 0 &&
    n.dueSoonTasks.length === 0 &&
    n.liveTasks.length === 0 &&
    n.meetings.length === 0 &&
    n.cracks.length === 0 &&
    n.decide.total === 0 &&
    n.curation.changes.length === 0 &&
    n.curation.proposals.length === 0 &&
    n.curation.contactsAdded.length === 0
  )
}

export { STALE_CONTACT_DAYS }
