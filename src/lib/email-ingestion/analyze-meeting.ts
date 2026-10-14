import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import {
  buildMeetingSystemPrompt,
  MEETING_INTAKE_PROMPT_VERSION,
  type MeetingIntakeExtraction,
} from '@/lib/ai/prompts/meeting-intake'
import { matchExtractedParties, type PartyMatch } from '@/lib/ai/proposal-matching'
import { EmailIntakeError, SYSTEM_USER_ID, maxInputChars } from '@/lib/email-ingestion/analyze'
import type { JsonIn } from '@/lib/supabase/types'

/**
 * Meeting Notes Intake processing path.
 *
 * Mirrors {@link analyzeEmailReport} but for pasted meeting notes: one Gemini pass
 * maps the notes into a structured recap (summary, minutes, attendees, decisions,
 * follow-up tasks, referenced records), then reuses the party matcher and the
 * meeting-target resolver to pre-resolve the existing records the meeting touched. Stages a
 * `pending` `email_intake_sessions` row with `intake_kind='meeting'` for the same
 * human review/confirm step. Never auto-confirms.
 */

/** A referenced record pre-matched to an existing project/opportunity (aligned to
 *  extraction.referenced_records by index). */
export interface ReferencedMatch {
  index: number
  matched_id: string | null
  matched_name: string | null
  /**
   * Which TABLE the match came from — and it may disagree with the model's own
   * `referenced_records[i].kind`.
   *
   * ⚠ THE MODEL'S `kind` IS A GUESS AND THE MATCH IS A FACT. It has no sight of
   * the database (said out loud in `prompts/meeting-intake.ts`), and it gets
   * this wrong routinely: "Elite Solutions" is an `opportunities` row and
   * arrived labelled `project`. The review screen seeds a target from the
   * model's kind and the resolver's ID, so without this the confirm step would
   * write an opportunity's uuid into `projects` — either a foreign-key failure
   * or a silently dropped target.
   *
   * Absent on sessions staged before 2026-10-14; readers fall back to the
   * model's `kind`, which is what they used all along.
   */
  matched_kind?: 'project' | 'opportunity' | null
}

/** A person known before AI runs (e.g. from a picked calendar event). */
export interface SeedAttendee {
  name: string
  email: string | null
}

export interface AnalyzeMeetingInput {
  rawText: string
  title: string | null
  meetingDate: string | null
  /** Owner of the ingest — a real user id, or SYSTEM_USER_ID for machine delivery. */
  userId: string
  /** Attendees known up front (calendar) — merged into the extraction, deduped. */
  seedAttendees?: SeedAttendee[]
  /**
   * Google Drive file id this session was imported from (Meet transcript).
   * Written in the same INSERT as the session so idempotency is enforced by the
   * unique index rather than by the importer stamping it afterwards — a second
   * run racing the first loses at the database, not halfway through.
   */
  driveFileId?: string | null
  /**
   * A record the CALLER already resolved — for Meet, the deal named in the
   * meeting title. Folded into `referenced_records` with its match pre-filled so
   * the review screen opens with the target selected instead of making the
   * reviewer find it. The AI's own references still stand on their own; this only
   * adds one it may have missed, and never overrides a match it made.
   */
  seedTarget?: SeedTarget | null
  /**
   * The title as the ORGANIZER typed it into the calendar invitation.
   *
   * ⚠ KEPT APART FROM `title` AND FROM THE MODEL'S OWN `extraction.title`, which
   * is a rewrite: "Ber Wilson / Zenthium" came back as "Steelton & Riverdale
   * Site Reviews & Power Capacity Analysis". Both are wanted and they do
   * different jobs — the rewrite is what a human reads in the queue, the
   * invitation is what the matcher FILES on and what meeting-title learning
   * stores, because it is the string the next call in the series will arrive
   * under. See the 20261008000004 migration.
   *
   * Null for pasted notes, which have no invitation.
   */
  sourceTitle?: string | null
  /**
   * What to STORE as the session's raw_text, when that differs from what the
   * model was given. Meet's note document holds a recap and the verbatim
   * transcript; only the recap is worth a model pass, but throwing the
   * transcript away would lose the evidence for any meeting the reviewer has yet
   * to file. The model reads `rawText`; the row keeps this.
   */
  retainText?: string | null
}

/** A project or opportunity resolved before the AI pass ran. */
export interface SeedTarget {
  kind: 'project' | 'opportunity'
  id: string
  name: string
}

export interface AnalyzeMeetingResult {
  session_id: string
  extraction: MeetingIntakeExtraction
  referenced_matches: ReferencedMatch[]
  party_matches: PartyMatch[]
  truncated: boolean
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function nullableDate(v: unknown): string | null {
  const s = nullableStr(v)
  return s && ISO_DATE.test(s) ? s : null
}

/** Normalize the raw model output into a clean MeetingIntakeExtraction. */
function normalize(
  raw: Partial<MeetingIntakeExtraction> | null,
  fallbackTitle: string | null,
  fallbackDate: string | null,
): MeetingIntakeExtraction {
  const r = raw ?? {}
  return {
    title: nullableStr(r.title) ?? fallbackTitle,
    meeting_date: nullableDate(r.meeting_date) ?? fallbackDate,
    summary: nullableStr(r.summary) ?? '',
    minutes: nullableStr(r.minutes),
    attendees: Array.isArray(r.attendees)
      ? r.attendees
          .filter((p) => p && nullableStr(p.name))
          .map((p) => ({
            name: (p.name as string).trim(),
            email: nullableStr(p.email),
            company: nullableStr(p.company),
            title: nullableStr(p.title),
            role: nullableStr(p.role),
            is_organization: p.is_organization === true,
          }))
      : [],
    decisions: Array.isArray(r.decisions)
      ? r.decisions.map((d) => nullableStr(d)).filter((d): d is string => !!d)
      : [],
    referenced_records: Array.isArray(r.referenced_records)
      ? r.referenced_records
          .filter((rec) => rec && nullableStr(rec.name))
          .map((rec) => ({
            kind: rec.kind === 'opportunity' ? ('opportunity' as const) : ('project' as const),
            name: (rec.name as string).trim(),
            note: nullableStr(rec.note),
          }))
      : [],
    tasks: Array.isArray(r.tasks)
      ? r.tasks
          .filter((t) => t && nullableStr(t.title))
          .map((t) => ({
            title: (t.title as string).trim(),
            what: nullableStr(t.what),
            why: nullableStr(t.why),
            how: nullableStr(t.how),
            assignee: nullableStr(t.assignee),
            due_date: nullableDate(t.due_date),
            record_hint: nullableStr(t.record_hint),
          }))
      : [],
    confidence: nullableNum(r.confidence) ?? 0,
  }
}

/**
 * Pre-match each deal the meeting NAMED to the record it is, for the review
 * screen to open with.
 *
 * ⚠ THE STOPWORD LIST AND THE MATCHING THAT USED IT BOTH LIVED HERE AND ARE NOW
 * IN `meetings/file-notes.ts`, which had grown its own better-tuned copy of the
 * same idea against the same corpus (industry words included, place names
 * deliberately excluded). Two lists meant two behaviours for one question;
 * `resolveMeetingTarget` is the survivor. See the body for the measurement.
 */
async function matchReferencedRecords(
  extraction: MeetingIntakeExtraction,
): Promise<ReferencedMatch[]> {
  const refs = extraction.referenced_records
  const out: ReferencedMatch[] = refs.map((_, index) => ({ index, matched_id: null, matched_name: null }))
  if (refs.length === 0) return out

  // ⚠ THE RESOLVER ALREADY EXISTED AND WAS WIRED TO ONE SURFACE (§12: a shared
  // renderer wired to one surface is worse than no shared renderer — grep for
  // one before building, and for every surface that should call it after).
  // `resolveMeetingTarget` is what the Meet importer uses on a meeting TITLE; it
  // is the same question asked of a deal the meeting NAMED, and it carries the
  // stopword list that was tuned against this corpus, both tables, the learned
  // titles and the ambiguity refusal.
  //
  // What was here instead: `findMatchingProjects` (a trigram RPC at threshold
  // 0.3) for projects, and a bare `ilike('name', …)` — exact, no wildcards —
  // for opportunities. Measured 2026-10-14 across every staged meeting: **5 of
  // 52 named deals matched; the same 52 through this resolver match 23.**
  //
  // The cliff is the reason, and it is §12's rule word for word — a fuzzy
  // threshold is measured against the real corpus, never chosen. Two
  // identically shaped names fell on either side of one hand-picked number:
  //
  //     "Riverdale Site" → "Riverdale — Cleveland-Cliffs (IL)"  = 0.30303  ✓
  //     "Steelton Site"  → "Steelton — Cleveland-Cliffs (PA)"   = 0.290323 ✗
  //
  // Steelton returned NO candidates at all, so the reviewer saw a blank
  // pre-match on a deal the platform holds 162 documents for. Lowering 0.3 only
  // moves the cliff; WHICH word matched is the signal, which is what the
  // resolver reads.
  //
  // ⚠ A SUGGESTION IS STILL ONLY A PRE-TICK. `target` (an exact name or a
  // learned title) and `suggestion` (a shared identity-bearing word) are
  // deliberately different bars in that resolver, and both land here as the
  // same pre-filled match — because this value only ever decides what the
  // REVIEW SCREEN opens with. Nothing in this function files anything.
  const { resolveMeetingTarget } = await import('@/lib/meetings/file-notes')

  for (let i = 0; i < refs.length; i++) {
    try {
      const res = await resolveMeetingTarget([refs[i].name])
      const pick = res.target ?? res.suggestion
      // The model says `kind`, but it has no sight of the database and gets it
      // wrong routinely — "Elite Solutions" is an opportunity and arrived as a
      // project. The resolver searched BOTH tables, so its answer carries the
      // real kind and the reviewer is shown the record that exists.
      if (pick) {
        out[i] = { index: i, matched_id: pick.id, matched_name: pick.name, matched_kind: pick.kind }
      }
    } catch {
      /* non-fatal — the UI still lets the reviewer pick a target by hand */
    }
  }

  return out
}

/**
 * Run one Gemini pass over pasted meeting notes, pre-resolve matches, and stage a
 * pending review session. Throws {@link EmailIntakeError} (with an HTTP status) on
 * failure so callers can translate it to a Response.
 */
/**
 * Add a caller-resolved target to the extraction's referenced records, matched.
 *
 * If the AI already named the same record AND that reference resolved to the same
 * row, nothing is added — the reviewer would see it twice. If the AI named it but
 * the name did not resolve, the match is filled in rather than duplicated: that
 * is the common case, a deal the model spelled slightly differently.
 */
function mergeSeedTarget(
  extraction: MeetingIntakeExtraction,
  matches: ReferencedMatch[],
  seed: SeedTarget,
): void {
  const already = matches.find((m) => m.matched_id === seed.id)
  if (already) return

  const sameName = extraction.referenced_records.findIndex(
    (r) => r.kind === seed.kind && r.name.trim().toLowerCase() === seed.name.trim().toLowerCase(),
  )
  if (sameName >= 0) {
    const m = matches.find((x) => x.index === sameName)
    if (m && !m.matched_id) {
      m.matched_id = seed.id
      m.matched_name = seed.name
      return
    }
    if (m) return
  }

  const index = extraction.referenced_records.length
  extraction.referenced_records.push({
    kind: seed.kind,
    name: seed.name,
    note: 'Named in the meeting title.',
  })
  matches.push({ index, matched_id: seed.id, matched_name: seed.name })
}

/** Merge calendar-known attendees into the AI extraction (dedupe by email/name). */
function mergeSeedAttendees(extraction: MeetingIntakeExtraction, seeds: SeedAttendee[]): void {
  for (const s of seeds) {
    const name = s.name?.trim()
    if (!name) continue
    const dup = extraction.attendees.some(
      (a) =>
        (s.email && a.email && a.email.toLowerCase() === s.email.toLowerCase()) ||
        a.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (dup) continue
    extraction.attendees.push({
      name, email: s.email, company: null, title: null, role: null, is_organization: false,
    })
  }
}

/**
 * Run one Gemini pass over meeting text and return the normalized extraction —
 * WITHOUT staging a session. Shared by {@link analyzeMeetingNotes} (first pass)
 * and the in-review re-draft. Throws {@link EmailIntakeError} on failure.
 */
export async function extractMeeting(input: {
  rawText: string
  title: string | null
  meetingDate: string | null
  userId: string
}): Promise<MeetingIntakeExtraction> {
  const { userId, title, meetingDate } = input
  const supabase = createAdminClient()

  // ⚠ `maxInputChars()`, never the old MAX_CHARS, which was the 200,000-char
  // GEMINI cost guard applied whatever the live provider was. The local model's
  // real ceiling is 40,000, so a transcript pasted into the Meeting tab was fed
  // five times what it can hold. Only the Meet IMPORT path was safe, and only
  // because gemini-notes.ts sends the ~10KB recap instead of the whole export —
  // a workaround that said so in a comment while the paste path stayed exposed.
  const cap = maxInputChars()
  let text = input.rawText
  if (text.length > cap) text = text.slice(0, cap)

  // Roster of active team members so the model normalizes task owners to real
  // people (the review screen pre-selects the match). Non-fatal if it fails.
  const { data: memberRows } = await supabase
    .from('team_members')
    .select('name')
    .eq('active', true)
  const roster = (memberRows ?? []).map((m) => m.name)

  try {
    const { data } = await callGemini<Partial<MeetingIntakeExtraction> | string>({
      task: 'meeting-intake',
      systemPrompt: buildMeetingSystemPrompt(roster),
      userMessage: text,
      userId,
      promptVersion: MEETING_INTAKE_PROMPT_VERSION,
      maxTokens: 8192,
    })
    if (!data || typeof data !== 'object') {
      throw new EmailIntakeError(422, 'The AI could not parse these notes. Try a cleaner paste.')
    }
    return normalize(data as Partial<MeetingIntakeExtraction>, title, meetingDate)
  } catch (err) {
    if (err instanceof EmailIntakeError) throw err
    console.error('Meeting intake analyze failed:', err)
    throw new EmailIntakeError(500, 'AI analysis failed. Check the AI provider and try again.')
  }
}

export async function analyzeMeetingNotes(input: AnalyzeMeetingInput): Promise<AnalyzeMeetingResult> {
  const { userId, title, meetingDate } = input
  const supabase = createAdminClient()

  const cap = maxInputChars()
  const truncated = input.rawText.length > cap
  const text = truncated ? input.rawText.slice(0, cap) : input.rawText

  // 1. Map the notes into a structured recap via Gemini, then fold in any
  //    attendees already known from a picked calendar event.
  const extraction = await extractMeeting({ rawText: text, title, meetingDate, userId })
  if (input.seedAttendees?.length) mergeSeedAttendees(extraction, input.seedAttendees)

  // 2. Pre-resolve attendees + referenced records (all non-fatal).
  const attendeeParties = extraction.attendees.map((p) => ({
    name: p.name,
    company: p.company,
    role: p.role ?? '',
    email: p.email,
    phone: null,
    is_organization: p.is_organization,
  }))
  const [partyMatches, referencedMatches] = await Promise.all([
    matchExtractedParties(attendeeParties).catch(() => []),
    matchReferencedRecords(extraction).catch(() => []),
  ])

  if (input.seedTarget) mergeSeedTarget(extraction, referencedMatches, input.seedTarget)

  // 3. Stage the session for review (never auto-confirmed).
  const label = extraction.title ?? title
  const { data: session, error } = await supabase
    .from('email_intake_sessions')
    .insert({
      user_id: userId === SYSTEM_USER_ID ? null : userId,
      intake_kind: 'meeting',
      status: 'pending',
      drive_file_id: input.driveFileId ?? null,
      source_title: input.sourceTitle ?? null,
      label,
      raw_text: input.retainText ?? text,
      extraction_result: extraction as unknown as JsonIn,
      match_candidates: referencedMatches as unknown as JsonIn,
      party_matches: partyMatches as unknown as JsonIn,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Stage meeting intake session failed:', error)
    throw new EmailIntakeError(500, `Could not stage the session: ${error.message}`)
  }

  return {
    session_id: session.id,
    extraction,
    referenced_matches: referencedMatches,
    party_matches: partyMatches,
    truncated,
  }
}
