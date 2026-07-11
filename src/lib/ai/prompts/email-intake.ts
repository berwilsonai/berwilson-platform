/**
 * Email Ingestion extraction prompt.
 *
 * The in-platform Email Research run (/api/email-research/run) gathers Outlook
 * threads + attachments and produces a markdown research package (per-thread
 * transcripts + attachment extractions); reports can also be pasted manually.
 * This prompt maps that package into a single proposed CRM record — an Opportunity
 * OR a Project — plus the people to capture as contacts and the tasks to open.
 *
 * The model suggests which record kind fits; the human picks the final kind in the
 * review screen. Sector/stage/opp_type values must come from the platform's
 * constants (validated again server-side): see src/lib/utils/constants.ts and
 * src/lib/utils/opportunities.ts.
 */

export const EMAIL_INTAKE_PROMPT_VERSION = 'email-intake-1.0'

export interface EmailIntakePerson {
  name: string
  email: string | null
  company: string | null
  title: string | null
  /** How they relate to this opportunity/project (e.g. "GC contact", "owner's rep", "lender"). */
  role: string | null
  is_organization: boolean
}

export interface EmailIntakeTask {
  title: string
  what: string | null
  why: string | null
  how: string | null
  /** Best-guess assignee name (matched to a team member server-side; unknowns dropped). */
  assignee: string | null
  /** ISO date YYYY-MM-DD or null. */
  due_date: string | null
}

export interface EmailIntakeOpportunity {
  name: string | null
  /** acquisition | partnership | joint_venture | investment | merger | divestiture | teaming | market_entry | other */
  opp_type: string | null
  /** government | infrastructure | real_estate | prefab | institutional | technology | health */
  sector: string | null
  location: string | null
  objective: string | null
  thesis: string | null
  target_name: string | null
  counterparty: string | null
  estimated_value: number | null
  next_step: string | null
}

export interface EmailIntakeProject {
  name: string | null
  /** government | infrastructure | real_estate | prefab | institutional | technology | health */
  sector: string | null
  /** pursuit | capture | bid | award | mobilization | execution | closeout */
  stage: string | null
  description: string | null
  estimated_value: number | null
  contract_type: string | null
  delivery_method: string | null
  location: string | null
  client_entity: string | null
}

export interface EmailIntakeExtraction {
  suggested_record: 'opportunity' | 'project'
  opportunity: EmailIntakeOpportunity
  project: EmailIntakeProject
  people: EmailIntakePerson[]
  tasks: EmailIntakeTask[]
  summary: string
  confidence: number
}

export const EMAIL_INTAKE_SYSTEM_PROMPT = `You are an intake analyst for Ber Wilson, a vertically integrated construction, development, and prefab steel manufacturing company. You are given a research package assembled from a set of email threads and their attachments — it contains people, key facts, decisions, action items, dates, and dollar figures pulled from real correspondence.

Your job is to turn that raw package into ONE proposed CRM record so an executive can review and confirm it. Decide whether the correspondence describes:
- a "project" — a construction/development pursuit Ber Wilson would build or bid (federal/infrastructure/real-estate/prefab/institutional/technology/health work), OR
- an "opportunity" — a strategic pursuit that is NOT a build job: an acquisition, partnership, joint venture, equity investment, merger, divestiture, teaming agreement, or market entry.

Set "suggested_record" to your best call. Fill in BOTH the "opportunity" and "project" objects as completely as the text supports (leave unknown fields null) so the reviewer can switch kinds without losing information. Use only values from these enumerations:
- opp_type: acquisition | partnership | joint_venture | investment | merger | divestiture | teaming | market_entry | other
- sector: government | infrastructure | real_estate | prefab | institutional | technology | health
- stage: pursuit | capture | bid | award | mobilization | execution | closeout

Extract every distinguishable person and organization into "people" (set is_organization=true for companies). Give each a short role describing how they relate to this deal. Turn concrete action items and next steps into "tasks" with a crisp title and, where the text supports it, what/why/how, a due_date (YYYY-MM-DD), and a best-guess assignee name.

Ground everything in the package — do not invent parties, dollar figures, dates, or scope that are not present. If a fact is uncertain, omit it rather than guessing. Keep the "summary" to 2-3 sentences an executive can skim.

Return ONLY valid JSON matching exactly this shape (no markdown, no commentary):
{
  "suggested_record": "opportunity" | "project",
  "opportunity": { "name": string|null, "opp_type": string|null, "sector": string|null, "location": string|null, "objective": string|null, "thesis": string|null, "target_name": string|null, "counterparty": string|null, "estimated_value": number|null, "next_step": string|null },
  "project": { "name": string|null, "sector": string|null, "stage": string|null, "description": string|null, "estimated_value": number|null, "contract_type": string|null, "delivery_method": string|null, "location": string|null, "client_entity": string|null },
  "people": [{ "name": string, "email": string|null, "company": string|null, "title": string|null, "role": string|null, "is_organization": boolean }],
  "tasks": [{ "title": string, "what": string|null, "why": string|null, "how": string|null, "assignee": string|null, "due_date": string|null }],
  "summary": string,
  "confidence": 0.0
}`
