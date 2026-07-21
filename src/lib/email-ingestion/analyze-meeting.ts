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

export interface AnalyzeMeetingInput {
  rawText: string
  title: string | null
  meetingDate: string | null
  /** Owner of the ingest — a real user id, or SYSTEM_USER_ID for machine delivery. */
  userId: string
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
export async function analyzeMeetingNotes(input: AnalyzeMeetingInput): Promise<AnalyzeMeetingResult> {
  const { userId, title, meetingDate } = input
  const supabase = createAdminClient()

  let text = input.rawText
  let truncated = false
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS)
    truncated = true
  }

  // Roster of active team members so the model normalizes task owners to real
  // people (the review screen pre-selects the match). Non-fatal if it fails.
  const { data: memberRows } = await supabase
    .from('team_members')
    .select('name')
    .eq('active', true)
  const roster = (memberRows ?? []).map((m) => m.name)

  // 1. Map the notes into a structured recap via Gemini.
  let extraction: MeetingIntakeExtraction
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
    extraction = normalize(data as Partial<MeetingIntakeExtraction>, title, meetingDate)
  } catch (err) {
    if (err instanceof EmailIntakeError) throw err
    console.error('Meeting intake analyze failed:', err)
    throw new EmailIntakeError(500, 'AI analysis failed. Check the AI provider and try again.')
  }

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

  // 3. Stage the session for review (never auto-confirmed).
  const label = extraction.title ?? title
  const { data: session, error } = await supabase
    .from('email_intake_sessions')
    .insert({
      user_id: userId === SYSTEM_USER_ID ? null : userId,
      intake_kind: 'meeting',
      status: 'pending',
      label,
      raw_text: text,
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
