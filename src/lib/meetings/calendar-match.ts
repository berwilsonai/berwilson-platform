/**
 * A recording, joined to the calendar invitation it was made in.
 *
 * ⚠ WHY THIS EXISTS, MEASURED ON THE LIVE DATABASE 2026-10-28. A Plaude export
 * named `10-23_Ber_Wilson_meeting_w_Brent_Bennett.mp3` was transcribed, filed
 * and registered — and its attendee list, written entirely from the transcript,
 * read `Eric`, `Ber Wilson Executive`, `Damon`, `Reef Capital`, `New York Life`,
 * `Casey Evans`, `Fly & Jay`, `Maverick`, `Taurus`, `Exos`, `J.P. Morgan`,
 * `Tenzer`. Twelve names, of which **not one was right**: two people were in
 * that room, and both of them were sitting in the calendar invitation
 * `Ber Wilson meeting w Brent Bennett` with their email addresses attached
 * (`moose@berwilson.com`, `brent@getbennett.com`), on the Studio, an API call
 * away. The meeting was also dated 10-27 — the day the file reached Drive —
 * because its name carries no year and so the filename date parser correctly
 * refused it, leaving Drive's own `modifiedTime` as the only clock.
 *
 * Only the Meet importer had ever looked at the calendar, and even there the
 * invitees were handed to the MODEL as a hint and never written to the row, so
 * a recap that failed to mention somebody lost them. Every other recording door
 * — Drive audio, voice memos, an iPhone call note, an uploaded mp3 — said in a
 * comment that nobody could be known structurally. For a recording made during
 * a meeting that is on the calendar, that was never true.
 *
 * ⚠ AN INVITATION IS A FACT, A TRANSCRIPT IS A READING. Whisper writes no
 * speaker labels, a surname is rarely said aloud, and the extraction prompt is
 * asked for everyone "present or referenced" — so the model's list is a mix of
 * the room and the market. The invitation names the room, by ADDRESS, which §12
 * calls the better key. So the invitees are ASSERTED onto the row: unioned into
 * whatever the transcript produced, matched on email first and name second,
 * never dropped because the model failed to hear them.
 *
 * ⚠ TWO JOINS, BOTH FACTS, NEITHER A SIMILARITY SCORE.
 *   - **title**, for a recording a human named after the meeting. Exact once
 *     normalized, or containment either way — and containment is admitted only
 *     where the shorter string carries three significant words, because of what
 *     the real corpus looks like: of 203 events on the two executive calendars
 *     in 2026, 43 have three tokens or fewer and 33 of those are one recurring
 *     personal event ("KAVA Talks"). A two-word subject inside a long filename
 *     is a coincidence, not a join.
 *   - **clock**, for a recording named by its own timestamp — which is every
 *     iPhone voice memo, the source with the WORST titles and the BEST times.
 *     A recording that starts inside a calendar event's own span is that
 *     meeting. Only ever asked when the timestamp is the recording's and not a
 *     file's upload time, and refused outright when two events contain it
 *     (§12: ambiguity must mean no match).
 *
 * ⚠ AND THE WINDOW IS ASYMMETRIC WHEN THE CLOCK IS A FALLBACK. A hardware
 * recorder's file reaches Drive when somebody gets round to dragging it there,
 * which is at or after the conversation and never before — four days after, in
 * the case above. So an inexact timestamp searches BACKWARD generously and
 * forward barely at all, which is the shape of the real error.
 */

import {
  fetchCalendarEvents,
  MAILBOXES,
  type CalendarEvent,
  type CalendarAttendee,
} from '@/lib/integrations/google-workspace'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MeetingAttendee } from '@/lib/utils/meetings'

/** Days searched BEFORE an inexact timestamp (a file's upload time). */
export const FALLBACK_LOOKBACK_DAYS = 10
/** Days searched AFTER an inexact timestamp. A conversation cannot post-date
 *  the file that holds it; the slack is for a timezone, not for a meeting. */
export const FALLBACK_LOOKAHEAD_DAYS = 1
/** Days either side of a timestamp the recorder itself wrote. */
export const EXACT_WINDOW_DAYS = 1
/**
 * How early a recording may start and still be that meeting's.
 *
 * ⚠ LEAD-IN ONLY, AND THAT IS NOT FUSSINESS — A SYMMETRIC SLACK BROKE THE JOIN
 * ON THE FIRST REAL CALENDAR IT MET. 23 October holds a 15-minute
 * `Prep for Ber Wilson meeting w Brent Bennett` ending at 12:30 and the meeting
 * itself starting at 12:30, so twenty minutes of slack past the end made a
 * 12:35 recording "contained" by both and the ambiguity rule refused the pair.
 * Back-to-back blocks are the normal shape of a worked calendar. A recording
 * STARTS once, so the question is which span it starts in — half-open
 * `[start, end)` partitions neighbours exactly, and the only honest slack is
 * before the start, for somebody who pressed record as they sat down.
 */
export const CLOCK_LEAD_MS = 15 * 60 * 1000

/**
 * The invitee count above which only people we ALREADY know are asserted.
 *
 * ⚠ MEASURED, AND THERE IS NO CLEAN GAP — WHICH IS WHY THIS BOUNDS DAMAGE
 * RATHER THAN CLASSIFYING. Across the 203 events on the two executive
 * calendars in 2026 the invitee counts run 0:96 1:2 2:13 3:18 4:22 5:6 6:1 7:2
 * 11:2 12:4 14:28 17:1 34:1 76:6 78:1. Every real deal meeting sits at or below
 * twelve — `Ber Wilson/TensorIQ/Elite Solutions`, the prefab factory tour, the
 * two Vultr calls. The twenty-eight at fourteen are one recurring community
 * event, and everything above is a conference or a webinar. §12 warns that two
 * identically shaped things fall either side of any number you pick, and 12
 * against 14 is exactly that, so the rule is deliberately NOT "refuse the
 * event": above this size the invitees who already resolve to a contact or a
 * colleague are still asserted, and only the strangers are dropped. A big deal
 * call keeps its people; a webinar adds nobody to the directory queue.
 *
 * Re-measure before moving it. Nudging it is how the corpus stops being the
 * reason for the number.
 */
export const SMALL_MEETING_INVITEES = 12

/**
 * Addresses that are not a person, and never will be.
 *
 * Apple's iMIP proxy (`…@imip.me.com`, three of them live here) is how an
 * invitation forwarded through iCloud presents a real human — and one of them
 * is the ORGANIZER of a live meeting, who is our own Eric. So this does not
 * drop the person: it drops the ADDRESS, leaving a plain named slot that the
 * name matcher and the findings queue treat like any name off a transcript.
 * Asserting the string as an email would be worse than having none, because
 * everything downstream trusts an address exactly. A Google room or
 * shared-calendar address is a resource and has no person behind it at all.
 */
const NON_PERSON_ADDRESS = /@(imip\.me\.com|[a-z0-9.-]*calendar\.google\.com)$/i

/**
 * Words that carry no identity in a meeting title.
 *
 * ⚠ DELIBERATELY SHORT AND DELIBERATELY NOT PLACE NAMES (§12). Its only job is
 * to stop "meeting", "call" and the joining words from counting toward the
 * three-word containment floor — a word like "Tooele" or "Delta" is the whole
 * signal, and a stopword list that eats place names is how a matcher goes blind
 * to the deals it exists to find.
 */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'call', 'for', 'in', 'meet', 'meeting', 'mtg',
  'of', 'on', 'the', 'to', 'w', 'with', 'zoom',
])

export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The words in a title that could identify anything. */
export function significantTokens(s: string): string[] {
  return normalizeTitle(s)
    .split(' ')
    .filter((t) => t.length > 0 && !TITLE_STOPWORDS.has(t) && !/^\d+$/.test(t))
}

/** How the join was made. Carried onto the row's provenance, never guessed at. */
export type CalendarMatchVia = 'title' | 'clock' | 'title+clock'

export interface RecordingCalendarMatch {
  event: CalendarEvent
  via: CalendarMatchVia
}

export interface RecordingClock {
  /** ISO instant the recording is believed to have started. */
  recordedAt: string
  /**
   * True when that instant came from the RECORDER (a voice memo's creation
   * time, a date in the file's own name); false when it is a stand-in such as
   * a Drive file's modified time. Only an exact clock may make a clock join,
   * and an inexact one widens the window backward — see the header.
   */
  exact: boolean
}

/** Candidate window for a given clock, as ISO instants. */
export function searchWindow(clock: RecordingClock): { timeMin: string; timeMax: string } {
  const at = Date.parse(clock.recordedAt)
  const day = 86_400_000
  const back = (clock.exact ? EXACT_WINDOW_DAYS : FALLBACK_LOOKBACK_DAYS) * day
  const fwd = (clock.exact ? EXACT_WINDOW_DAYS : FALLBACK_LOOKAHEAD_DAYS) * day
  return {
    timeMin: new Date(at - back).toISOString(),
    timeMax: new Date(at + fwd).toISOString(),
  }
}

/**
 * The same meeting is on both executives' calendars under one id, and a
 * recurring series can exist twice under two (`dedupeEvents` in
 * google-workspace.ts, found when the morning text rendered KAVA Talks twice).
 * Key on the id AND on start+subject so neither shape double-counts, and merge
 * the attendee lists rather than taking whichever mailbox answered first.
 */
export function dedupeCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const byKey = new Map<string, CalendarEvent>()
  for (const e of events) {
    const key = `${e.start}|${normalizeTitle(e.subject)}`
    const existing = byKey.get(key) ?? byKey.get(e.id)
    if (!existing) {
      const copy = { ...e, attendees: [...e.attendees] }
      byKey.set(key, copy)
      byKey.set(e.id, copy)
      continue
    }
    const seen = new Set(existing.attendees.map((a) => a.email))
    for (const a of e.attendees) {
      if (seen.has(a.email)) continue
      seen.add(a.email)
      existing.attendees.push(a)
    }
  }
  return [...new Set(byKey.values())]
}

/**
 * Title agreement between a recording's own name and an event's subject.
 *
 * 3 = the same string once normalized. 2 = one contains the other AND the
 * shorter one carries three significant words. 0 = no join.
 */
export function titleScore(recordingTitle: string, subject: string): 0 | 2 | 3 {
  const want = normalizeTitle(recordingTitle)
  const have = normalizeTitle(subject)
  if (!want || !have) return 0
  if (want === have) return 3
  if (!have.includes(want) && !want.includes(have)) return 0
  const shorter = want.length <= have.length ? want : have
  return significantTokens(shorter).length >= 3 ? 2 : 0
}

/**
 * Where this recording's start sits against the event's span.
 *
 * `inside` is the half-open `[start, end)`. `lead` is the quarter-hour before
 * it. Null is everything else, including every all-day event — a date-only
 * block says nothing about a time.
 */
export function clockContains(event: CalendarEvent, recordedAt: string): 'inside' | 'lead' | null {
  if (event.isAllDay) return null
  const start = Date.parse(event.start)
  const end = Date.parse(event.end)
  const at = Date.parse(recordedAt)
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(at)) return null
  if (at >= start && at < end) return 'inside'
  if (at >= start - CLOCK_LEAD_MS && at < start) return 'lead'
  return null
}

/**
 * Is this event a MEETING, or a block somebody put on their own calendar?
 *
 * ⚠ THE CLOCK JOIN MUST NOT READ A SOLO BLOCK, and the same 23 October proves
 * why: `Prep for Ber Wilson meeting w Brent Bennett` has no invitees at all.
 * Neither does focus time, travel, a reminder or a lunch. Such a block has
 * nobody to contribute — `inviteeAttendees` would return its organizer alone —
 * so letting it compete only ever costs a real match through the ambiguity
 * rule. A TITLE match is held to no such bar: a recording a human named after
 * a solo block is still evidence about the day.
 */
export function hasInvitees(event: CalendarEvent): boolean {
  const organizer = event.organizer?.email?.toLowerCase() ?? null
  return event.attendees.some((a) => a.email.toLowerCase() !== organizer)
}

/**
 * Pick the event this recording was made in, or nothing.
 *
 * Pure, so the bar can be tested against the corpus that set it. Ranked rather
 * than thresholded: an exact title beats a clock, a clock beats a containment,
 * and a TIE AT THE TOP IS A REFUSAL — two events cannot both be the meeting.
 */
export function matchRecordingToEvent(
  opts: { title: string; clock: RecordingClock; events: CalendarEvent[] }
): RecordingCalendarMatch | null {
  const scored: { event: CalendarEvent; rank: number; via: CalendarMatchVia }[] = []

  for (const event of dedupeCalendarEvents(opts.events)) {
    const byTitle = titleScore(opts.title, event.subject)
    // Only a clock the RECORDER wrote may join on time, and only against an
    // event with somebody else on it. A Drive upload time lands in the middle
    // of an unrelated afternoon as readily as the right one, and a solo block
    // has no room to report.
    const byClock =
      opts.clock.exact && hasInvitees(event) ? clockContains(event, opts.clock.recordedAt) : null

    if (byTitle === 3 && byClock) scored.push({ event, rank: 6, via: 'title+clock' })
    else if (byTitle === 3) scored.push({ event, rank: 5, via: 'title' })
    else if (byTitle === 2 && byClock) scored.push({ event, rank: 4, via: 'title+clock' })
    // An event the recording started INSIDE beats one it only started shortly
    // before, so a meeting booked straight after a short block wins cleanly.
    else if (byClock === 'inside') scored.push({ event, rank: 3, via: 'clock' })
    else if (byClock === 'lead') scored.push({ event, rank: 2, via: 'clock' })
    else if (byTitle === 2) scored.push({ event, rank: 1, via: 'title' })
  }

  if (scored.length === 0) return null
  scored.sort((a, b) => b.rank - a.rank)
  // §12: one match is not a unique match — it is an unchallenged one, and two
  // equally good candidates mean the question has no answer.
  if (scored.length > 1 && scored[1].rank === scored[0].rank) return null
  return { event: scored[0].event, via: scored[0].via }
}

/**
 * Fetch the candidate events and run the join.
 *
 * Reads every executive mailbox, because an invitation on Eric's calendar is
 * the same fact about the room as one on Richard's. Never throws: a calendar
 * that cannot be read costs the attendee list, never the recording.
 */
export async function findRecordingCalendarEvent(
  opts: { title: string; clock: RecordingClock; mailboxes?: readonly string[] }
): Promise<RecordingCalendarMatch | null> {
  const { timeMin, timeMax } = searchWindow(opts.clock)
  const events: CalendarEvent[] = []
  for (const mailbox of opts.mailboxes ?? MAILBOXES) {
    const got = await fetchCalendarEvents(timeMin, timeMax, mailbox).catch((err) => {
      console.error(`[meetings/calendar-match] ${mailbox}: ${err instanceof Error ? err.message : err}`)
      return [] as CalendarEvent[]
    })
    events.push(...got)
  }
  if (events.length === 0) return null
  return matchRecordingToEvent({ title: opts.title, clock: opts.clock, events })
}

/**
 * Turn an event's invitees into attendee rows, resolved to directory contacts.
 *
 * ⚠ RESOLVED BY ADDRESS, WHICH IS THE WHOLE POINT. §12: a mailbox is a better
 * key than a name, and it is the only key here that cannot be two people. Three
 * sources answer, in falling order of authority:
 *   1. `team_members.email` → that colleague's own `parties` row. This is what
 *      puts "Richard White" rather than "moose@berwilson.com" on the row, and
 *      it is also the ONLY path by which one of ours is linked, so a
 *      counterparty can never inherit an internal contact.
 *   2. `parties.email` → the contact already on file.
 *   3. neither — the invitee is still listed, with their address, and reaches
 *      the `/contacts` → From calls queue for a human to add or dismiss. §11 is
 *      intact: nothing here creates a party.
 *
 * ⚠ A DECLINE IS THE ONE RESPONSE THAT REMOVES SOMEBODY. Everything else —
 * accepted, tentative, never answered — is listed, because most invitations are
 * never answered and an empty attendee list is the failure this module exists
 * to fix. An invitee who accepted and did not come is a wrong row a human can
 * delete in one click; an attendee nobody recorded is invisible forever.
 */
export async function inviteeAttendees(event: CalendarEvent): Promise<MeetingAttendee[]> {
  const invited: CalendarAttendee[] = event.attendees.filter((a) => a.response !== 'declined')

  // The organizer is in the room even when Google omits them from the list,
  // which it does for a single-invitee event.
  const addresses = new Set(invited.map((a) => a.email.toLowerCase()))
  if (event.organizer?.email && !addresses.has(event.organizer.email.toLowerCase())) {
    invited.push({
      name: event.organizer.name,
      email: event.organizer.email.toLowerCase(),
      response: 'accepted',
      optional: false,
    })
    addresses.add(event.organizer.email.toLowerCase())
  }
  if (invited.length === 0) return []

  const supabase = createAdminClient()
  // Only real addresses are looked up; an opaque one matches nothing anyway and
  // would otherwise widen the `.in()` for no reason.
  const wanted = [...addresses].filter((a) => !NON_PERSON_ADDRESS.test(a))
  if (wanted.length === 0 && invited.every((a) => NON_PERSON_ADDRESS.test(a.email))) {
    // Nothing resolvable, but the names are still the room.
    return invited.map((a) => ({
      name: a.name && a.name.toLowerCase() !== a.email.toLowerCase() ? a.name : a.email,
      role: null,
      org: null,
      email: null,
      party_id: null,
      team_member_id: null,
    }))
  }

  const [{ data: members }, { data: parties }] = await Promise.all([
    supabase.from('team_members').select('id, name, email, party_id').in('email', wanted),
    supabase
      .from('parties')
      .select('id, full_name, email, company, is_organization')
      .in('email', wanted)
      .is('merged_into_party_id', null),
  ])

  const memberByEmail = new Map<string, { id: string; name: string; party_id: string | null }>()
  for (const m of members ?? []) {
    if (m.email) memberByEmail.set(m.email.toLowerCase(), { id: m.id, name: m.name, party_id: m.party_id })
  }
  // ⚠ AN ADDRESS CLAIMED BY TWO CONTACTS RESOLVES TO NEITHER (§12). The column
  // carries no unique constraint, so this is a real shape and not a hypothesis.
  const partyByEmail = new Map<string, { id: string; full_name: string; company: string | null } | null>()
  for (const p of parties ?? []) {
    const key = (p.email ?? '').toLowerCase()
    if (!key) continue
    if (p.is_organization) continue
    partyByEmail.set(key, partyByEmail.has(key) ? null : { id: p.id, full_name: p.full_name ?? '', company: p.company })
  }

  // ⚠ AND AN INVITEE WHOSE ADDRESS IS OPAQUE IS STILL RESOLVED, BY EXACT NAME.
  // One of the three iMIP organizers on this calendar is our own Eric, and a
  // slot nothing links is a slot the meeting never reaches his profile from.
  // This is the SAME rule `linkAttendees` applies to an exact-name match and
  // not a looser one: the directory must hold exactly one person of that name
  // (§12 — ambiguity must mean no match, and one hit is an unchallenged match
  // rather than a unique one), and an organization is never a person who
  // attended.
  const byDisplayName = new Map<string, string | null>()
  const opaqueNames = invited
    .filter((a) => NON_PERSON_ADDRESS.test(a.email))
    .map((a) => a.name?.trim())
    .filter((n): n is string => !!n && n.length > 2)
  if (opaqueNames.length > 0) {
    const { data } = await supabase
      .from('parties')
      .select('id, full_name')
      .in('full_name', opaqueNames)
      .eq('is_organization', false)
      .is('merged_into_party_id', null)
    for (const p of data ?? []) {
      const key = (p.full_name ?? '').trim().toLowerCase()
      if (!key) continue
      byDisplayName.set(key, byDisplayName.has(key) ? null : p.id)
    }
  }

  // One `parties` read for the colleagues' own contact rows, so the NAME on the
  // row is the directory's ("Richard White"), not the login's ("Richard").
  const memberPartyIds = [...memberByEmail.values()].map((m) => m.party_id).filter((id): id is string => !!id)
  const memberParty = new Map<string, string>()
  if (memberPartyIds.length > 0) {
    const { data } = await supabase.from('parties').select('id, full_name').in('id', memberPartyIds)
    for (const p of data ?? []) if (p.full_name) memberParty.set(p.id, p.full_name)
  }

  // Above the measured size of a real meeting, only people already on file are
  // asserted — see SMALL_MEETING_INVITEES for why this is a bound and not a
  // classification.
  const broadcast = invited.length > SMALL_MEETING_INVITEES

  const out: MeetingAttendee[] = []
  const placedParty = new Set<string>()
  const placedName = new Set<string>()
  for (const a of invited) {
    const raw = a.email.toLowerCase()
    const opaque = NON_PERSON_ADDRESS.test(raw)
    const email = opaque ? null : raw
    const member = email ? memberByEmail.get(email) : undefined
    const party = (email ? partyByEmail.get(email) : null) ?? null
    const byName = opaque ? (byDisplayName.get((a.name ?? '').trim().toLowerCase()) ?? null) : null
    const partyId = member?.party_id ?? party?.id ?? byName

    if (broadcast && !partyId) continue

    const displayName =
      (member?.party_id ? memberParty.get(member.party_id) : null) ||
      party?.full_name ||
      member?.name ||
      // Google hands back the address as the display name when the invitee has
      // no Contacts entry; a name that is an address is not a name, but it is
      // still the honest label and the queue can resolve it.
      (a.name && a.name.toLowerCase() !== raw ? a.name : raw)

    // ⚠ ONE PERSON, ONE ROW, ON TWO ADDRESSES OR NONE. A colleague is routinely
    // on an invitation at both their work address and a personal or forwarded
    // one — measured here on three events, one of them an organizer behind
    // Apple's proxy — and two rows for one person log the meeting on their
    // profile twice. Keyed on the contact where there is one and on the name
    // where there is not, which is the only key an opaque address leaves.
    if (partyId) {
      if (placedParty.has(partyId)) continue
      placedParty.add(partyId)
    } else {
      const key = displayName.trim().toLowerCase()
      if (placedName.has(key)) continue
      placedName.add(key)
    }

    out.push({
      // ⚠ TRIMMED, AND IT IS NOT COSMETIC. `parseAttendees` trims on the way
      // back out of jsonb, so an untrimmed name here can never equal what was
      // stored — a real invitee on this calendar is `"Huge "` — and the
      // backfill's second run kept finding a difference and rewriting the row.
      // §12: pair every fill-not-overwrite pass with a script that calls it
      // twice and asserts the second run reports nothing. This is what that
      // assertion found.
      name: displayName.trim(),
      role: null,
      org: member ? 'Ber Wilson' : (party?.company ?? null),
      email,
      party_id: partyId,
      team_member_id: member?.id ?? null,
    })
  }
  return out
}
