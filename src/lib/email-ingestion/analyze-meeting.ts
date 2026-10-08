import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import {
  buildMeetingSystemPrompt,
  MEETING_INTAKE_PROMPT_VERSION,
  type MeetingIntakeExtraction,
} from '@/lib/ai/prompts/meeting-intake'
import {
  findMatchingProjects,
  matchExtractedParties,
  type ExtractedProject,
  type PartyMatch,
} from '@/lib/ai/proposal-matching'
import { EmailIntakeError, SYSTEM_USER_ID, MAX_CHARS } from '@/lib/email-ingestion/analyze'
import type { Json } from '@/types/database'

/**
 * Meeting Notes Intake processing path.
 *
 * Mirrors {@link analyzeEmailReport} but for pasted meeting notes: one Gemini pass
 * maps the notes into a structured recap (summary, minutes, attendees, decisions,
 * follow-up tasks, referenced records), then reuses the party matcher and project
 * matcher to pre-resolve the existing records the meeting touched. Stages a
 * `pending` `email_intake_sessions` row with `intake_kind='meeting'` for the same
 * human review/confirm step. Never auto-confirms.
 */

/** A referenced record pre-matched to an existing project/opportunity (aligned to
 *  extraction.referenced_records by index). */
export interface ReferencedMatch {
  index: number
  matched_id: string | null
  matched_name: string | null
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

/** Build a minimal ExtractedProject stub so we can reuse findMatchingProjects. */
function toProjectStub(name: string): ExtractedProject {
  return {
    name,
    description: null,
    sector: null,
    stage: null,
    estimated_value: null,
    contract_type: null,
    delivery_method: null,
    location: null,
    client_entity: null,
    solicitation_number: null,
    award_date: null,
    ntp_date: null,
    substantial_completion_date: null,
    scope_of_work: null,
    confidence: 0,
  }
}

/** Pre-match referenced records to existing projects (trigram/name via
 *  findMatchingProjects) and opportunities (name ilike). Non-fatal. */
/**
 * Words that carry no identity in a Ber Wilson record name.
 *
 * Four live projects are called Heber Development, Myton Development, Tonga
 * Development Project and American Energy Rail Corridor - Community Development,
 * so "Development" is shared vocabulary, not a name. §12 already records the same
 * trap for company domains: a shared industry word is the one thing an identifier
 * must not be.
 *
 * Place names are deliberately NOT here. Myton, Delta, Heber, Tooele and West
 * Wendover are exactly what distinguishes these projects from each other.
 */
const GENERIC_NAME_WORDS = new Set([
  'development', 'developments', 'project', 'projects', 'site', 'sites', 'campus',
  'expansion', 'portfolio', 'initiative', 'phase', 'center', 'centre', 'complex',
  'park', 'building', 'buildings', 'construction', 'community', 'corridor',
  'industrial', 'group', 'holdings', 'company', 'the', 'and', 'for', 'llc', 'inc',
])

/** Identity-bearing words in a record name, lowercased. */
function distinguishingWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w)),
  )
}

/**
 * Is this trigram hit strong enough to PRE-SELECT the record for the reviewer?
 *
 * ⚠ A score threshold cannot answer this, which was measured rather than assumed.
 * On the live corpus "Eagle Mountain Development" matched **Myton Development at
 * 0.487** — wrong — while "Delta, Utah Campus" matched **Delta Industrial Campus
 * — Daves Farms at 0.390** — right. The wrong match scores HIGHER, because the
 * only thing it shares is the word every fourth project here contains.
 *
 * What separates them is WHICH word matched. A pre-selection therefore requires
 * at least one shared identity-bearing word. Records that fail this still appear
 * in the review screen as suggestions the reviewer can add in one click, so
 * nothing is hidden — it just is not ticked on their behalf. §12: ambiguity must
 * mean no match, and one hit on a weak key is an unchallenged match, not a
 * unique one.
 */
function isConfidentNameMatch(extracted: string, candidate: string): boolean {
  const a = distinguishingWords(extracted)
  if (a.size === 0) return false
  const b = distinguishingWords(candidate)
  for (const w of a) if (b.has(w)) return true
  return false
}

async function matchReferencedRecords(
  extraction: MeetingIntakeExtraction,
): Promise<ReferencedMatch[]> {
  const refs = extraction.referenced_records
  const out: ReferencedMatch[] = refs.map((_, index) => ({ index, matched_id: null, matched_name: null }))

  // Projects — reuse the proposal matcher over stubs.
  const projectRefIndices = refs
    .map((r, i) => (r.kind === 'project' ? i : -1))
    .filter((i) => i >= 0)
  if (projectRefIndices.length > 0) {
    try {
      const stubs = projectRefIndices.map((i) => toProjectStub(refs[i].name))
      const candidates = await findMatchingProjects(stubs)
      // Keep the best candidate per stub index.
      const bestByStub = new Map<number, { id: string; name: string; score: number }>()
      for (const c of candidates) {
        const prev = bestByStub.get(c.extracted_project_index)
        if (!prev || c.score > prev.score) {
          bestByStub.set(c.extracted_project_index, { id: c.project_id, name: c.project_name, score: c.score })
        }
      }
      bestByStub.forEach((best, stubIdx) => {
        const refIndex = projectRefIndices[stubIdx]
        // Pre-select only on a shared identity-bearing word — see
        // isConfidentNameMatch. Everything else stays a suggestion.
        if (!isConfidentNameMatch(refs[refIndex].name, best.name)) return
        out[refIndex] = { index: refIndex, matched_id: best.id, matched_name: best.name }
      })
    } catch {
      /* non-fatal — the UI still lets the user pick a target manually */
    }
  }

  // Opportunities — cheap name ilike (no trigram RPC for this table).
  const oppRefIndices = refs
    .map((r, i) => (r.kind === 'opportunity' ? i : -1))
    .filter((i) => i >= 0)
  if (oppRefIndices.length > 0) {
    const supabase = createAdminClient()
    for (const i of oppRefIndices) {
      try {
        const { data } = await supabase
          .from('opportunities')
          .select('id, name')
          .ilike('name', refs[i].name)
          .limit(1)
        if (data && data[0]) out[i] = { index: i, matched_id: data[0].id, matched_name: data[0].name }
      } catch {
        /* non-fatal */
      }
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

  let text = input.rawText
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS)

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

  const truncated = input.rawText.length > MAX_CHARS
  const text = truncated ? input.rawText.slice(0, MAX_CHARS) : input.rawText

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
      extraction_result: extraction as unknown as Json,
      match_candidates: referencedMatches as unknown as Json,
      party_matches: partyMatches as unknown as Json,
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
