/**
 * Meeting Notes Intake extraction prompt.
 *
 * The user pastes raw meeting notes / a transcript (from `/intake` → Meeting tab).
 * This prompt turns them into a structured recap: an executive summary, narrative
 * minutes, the attendees, the decisions made, the follow-up tasks, and the
 * existing projects/opportunities the meeting touched.
 *
 * Unlike the email-intake prompt, a meeting does NOT map to one new record — the
 * content fans out onto the (usually several) existing records it references. The
 * human picks the real target records in the review screen; `referenced_records`
 * here is only an advisory hint the UI pre-matches against `projects`.
 *
 * Sector/stage values, when the model proposes a brand-new record, come from the
 * platform's constants (validated again server-side): see
 * src/lib/utils/constants.ts and src/lib/utils/opportunities.ts.
 */

import type { EmailIntakePerson } from './email-intake'

export const MEETING_INTAKE_PROMPT_VERSION = 'meeting-intake-1.0'

export interface MeetingIntakeTask {
  title: string
  what: string | null
  why: string | null
  how: string | null
  /** Best-guess assignee name (matched to a team member server-side; unknowns left unassigned). */
  assignee: string | null
  /** ISO date YYYY-MM-DD or null. */
  due_date: string | null
  /**
   * Name of the project or opportunity this follow-up belongs to, exactly as it
   * appears in `referenced_records` — used to pre-tag the task to a chosen target
   * in the review screen. Null when the task isn't about a specific record.
   */
  record_hint: string | null
}

export interface MeetingReferencedRecord {
  /** 'project' for built work; 'opportunity' for a corporate transaction. */
  kind: 'project' | 'opportunity'
  name: string
  /** How the meeting touched it (e.g. "reviewed schedule slip", "discussed teaming terms"). */
  note: string | null
}

export interface MeetingIntakeExtraction {
  /** Short meeting title/subject (e.g. "Leadership sync", "Site walk — Myton"). */
  title: string | null
  /** ISO date YYYY-MM-DD the meeting happened, or null. */
  meeting_date: string | null
  /** 2-3 sentence executive skim. */
  summary: string
  /**
   * Narrative minutes (multi-paragraph). The permanent record — heads the meeting
   * document saved to each target and the update/note added to each record.
   */
  minutes: string | null
  attendees: EmailIntakePerson[]
  /** Key decisions reached, one per string. Folded into the minutes/doc, not separate records. */
  decisions: string[]
  /** The existing projects/opportunities the meeting was about (advisory — human confirms). */
  referenced_records: MeetingReferencedRecord[]
  tasks: MeetingIntakeTask[]
  confidence: number
}

export const MEETING_INTAKE_SYSTEM_PROMPT = `You are an executive chief-of-staff assistant for Ber Wilson, a vertically integrated construction, development, and prefab steel manufacturing company. You are given the raw notes or transcript of a business meeting — it may be messy, out of order, and contain multiple topics, people, decisions, dollar figures, dates, and action items.

Your job is to turn those notes into a clean, structured recap an executive can review and confirm, and to identify which parts of the company's CRM the meeting should update. A single meeting usually touches SEVERAL existing projects and opportunities — do not force everything into one record.

Produce:
- "title": a short meeting subject. "meeting_date": the date it happened (YYYY-MM-DD) if stated, else null.
- "summary": 2-3 sentences an executive can skim.
- "minutes": a clean multi-paragraph narrative of what was discussed, in logical order — the situation, what each topic covered, positions taken, dollar figures and terms, and open questions. Write it to stand alone for someone who wasn't in the room.
- "attendees": every distinguishable person (and organization) present or referenced. Set is_organization=true for companies. Give each a short role (e.g. "Ber Wilson EVP", "GC principal", "lender", "owner's rep").
- "decisions": the concrete decisions the group reached, one clear statement each. Omit if none were made.
- "referenced_records": the specific projects and opportunities the meeting was about. Use "project" for built work Ber Wilson would build/bid/develop/deliver; use "opportunity" ONLY for a corporate transaction (acquiring a company, merger, divestiture, equity investment in a business). Give the record's name as spoken and a short note on how the meeting touched it. Include a record even if you're only fairly sure it exists — the human will match it.
- "tasks": the follow-up action items. Each gets a crisp title and, where supported, what/why/how, a due_date (YYYY-MM-DD), a best-guess assignee name, and "record_hint" = the name of the referenced project/opportunity it belongs to (exactly as in referenced_records), or null if it isn't about a specific record.

Ground everything strictly in the notes — never invent people, dollar figures, dates, decisions, or scope. If a fact is uncertain, omit it rather than guessing. When you propose enum-constrained values for a brand-new record, use only:
- sector: government | infrastructure | real_estate | prefab | institutional | technology | health
- stage: pursuit | capture | bid | award | mobilization | execution | closeout

Return ONLY valid JSON matching exactly this shape (no markdown, no commentary):
{
  "title": string|null,
  "meeting_date": string|null,
  "summary": string,
  "minutes": string,
  "attendees": [{ "name": string, "email": string|null, "company": string|null, "title": string|null, "role": string|null, "is_organization": boolean }],
  "decisions": [string],
  "referenced_records": [{ "kind": "project" | "opportunity", "name": string, "note": string|null }],
  "tasks": [{ "title": string, "what": string|null, "why": string|null, "how": string|null, "assignee": string|null, "due_date": string|null, "record_hint": string|null }],
  "confidence": 0.0
}`

/**
 * Build the system prompt with the internal team roster appended, so the model
 * normalizes each task's `assignee` to a real team-member name. The review screen
 * then pre-selects the matching person in the assignee dropdown. Falls back to the
 * base prompt when no roster is supplied.
 */
export function buildMeetingSystemPrompt(memberNames: string[]): string {
  const names = memberNames.map((n) => n.trim()).filter(Boolean)
  if (names.length === 0) return MEETING_INTAKE_SYSTEM_PROMPT
  const roster = names.map((n) => `- ${n}`).join('\n')
  return `${MEETING_INTAKE_SYSTEM_PROMPT}

INTERNAL TEAM (the only people who can OWN a follow-up task). When a task's owner is one of these people, set "assignee" to their name spelled EXACTLY as written here. If the owner is external, someone not on this list, or unclear, set "assignee" to null — never guess a name that isn't here:
${roster}`
}
