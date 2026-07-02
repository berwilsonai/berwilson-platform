import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { callGemini } from '@/lib/ai/gemini'
import {
  EMAIL_INTAKE_SYSTEM_PROMPT,
  EMAIL_INTAKE_PROMPT_VERSION,
  type EmailIntakeExtraction,
} from '@/lib/ai/prompts/email-intake'
import {
  findMatchingProjects,
  matchExtractedParties,
  type ProposalExtraction,
} from '@/lib/ai/proposal-matching'
import { assessFit } from '@/lib/ai/fit-assessment'
import { SECTORS } from '@/lib/utils/constants'
import { STAGES } from '@/lib/utils/constants'
import { OPPORTUNITY_TYPES, oppType } from '@/lib/utils/opportunities'
import type { ProjectSector, ProjectStage } from '@/lib/supabase/types'

export const maxDuration = 300

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
// Generous cap — gemini-2.5-flash has a large context window; the n8n package is
// already thread-truncated. Beyond this we trim to protect latency/cost.
const MAX_CHARS = 200_000

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

/** Normalize the raw model output into a clean EmailIntakeExtraction with validated enums. */
function normalize(raw: Partial<EmailIntakeExtraction> | null): EmailIntakeExtraction {
  const r = raw ?? {}
  const opp = r.opportunity ?? ({} as EmailIntakeExtraction['opportunity'])
  const proj = r.project ?? ({} as EmailIntakeExtraction['project'])

  const validSector = (v: unknown): string | null =>
    SECTORS.includes(v as ProjectSector) ? (v as string) : null
  const validStage = (v: unknown): string | null =>
    STAGES.includes(v as ProjectStage) ? (v as string) : null
  const validOppType = (v: unknown): string | null =>
    OPPORTUNITY_TYPES.includes(oppType(v as string)) && v ? oppType(v as string) : null

  return {
    suggested_record: r.suggested_record === 'project' ? 'project' : 'opportunity',
    opportunity: {
      name: nullableStr(opp.name),
      opp_type: validOppType(opp.opp_type),
      sector: validSector(opp.sector),
      location: nullableStr(opp.location),
      objective: nullableStr(opp.objective),
      thesis: nullableStr(opp.thesis),
      target_name: nullableStr(opp.target_name),
      counterparty: nullableStr(opp.counterparty),
      estimated_value: nullableNum(opp.estimated_value),
      next_step: nullableStr(opp.next_step),
    },
    project: {
      name: nullableStr(proj.name),
      sector: validSector(proj.sector),
      stage: validStage(proj.stage),
      description: nullableStr(proj.description),
      estimated_value: nullableNum(proj.estimated_value),
      contract_type: nullableStr(proj.contract_type),
      delivery_method: nullableStr(proj.delivery_method),
      location: nullableStr(proj.location),
      client_entity: nullableStr(proj.client_entity),
    },
    people: Array.isArray(r.people)
      ? r.people
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
    tasks: Array.isArray(r.tasks)
      ? r.tasks
          .filter((t) => t && nullableStr(t.title))
          .map((t) => ({
            title: (t.title as string).trim(),
            what: nullableStr(t.what),
            why: nullableStr(t.why),
            how: nullableStr(t.how),
            assignee: nullableStr(t.assignee),
            due_date: nullableStr(t.due_date),
          }))
      : [],
    summary: nullableStr(r.summary) ?? '',
    confidence: nullableNum(r.confidence) ?? 0,
  }
}

/** Adapt the unified email extraction into a ProposalExtraction so we can reuse the
 *  existing project/party matchers and the fit-assessment engine. */
function toProposalExtraction(ex: EmailIntakeExtraction): ProposalExtraction {
  const usingProject = ex.suggested_record === 'project'
  const name = usingProject ? ex.project.name : ex.opportunity.name
  return {
    document_type: 'other',
    intake_summary: ex.summary,
    developer_company: null,
    projects: [
      {
        name,
        description: ex.project.description ?? ex.opportunity.objective,
        sector: ex.project.sector ?? ex.opportunity.sector,
        stage: ex.project.stage,
        estimated_value: usingProject ? ex.project.estimated_value : ex.opportunity.estimated_value,
        contract_type: ex.project.contract_type,
        delivery_method: ex.project.delivery_method,
        location: ex.project.location ?? ex.opportunity.location,
        client_entity: ex.project.client_entity ?? ex.opportunity.counterparty,
        solicitation_number: null,
        award_date: null,
        ntp_date: null,
        substantial_completion_date: null,
        scope_of_work: ex.opportunity.thesis ?? ex.project.description,
        confidence: ex.confidence,
      },
    ],
    parties: ex.people.map((p) => ({
      name: p.name,
      company: p.company,
      role: p.role ?? '',
      email: p.email,
      phone: null,
      is_organization: p.is_organization,
    })),
    entities: [],
    risks: [],
    compliance_requirements: [],
    bonding_required: null,
    confidence: ex.confidence,
    field_confidences: {},
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    /* fall back to system user */
  }

  const body = await request.json().catch(() => ({}))
  const label = nullableStr(body.label)
  let text = nullableStr(body.raw_text) ?? ''

  // Uploaded .md/.txt path: read from the documents bucket.
  if (!text && body.storage_path) {
    const { data, error } = await supabase.storage.from('documents').download(body.storage_path)
    if (error || !data) {
      return Response.json({ error: 'Could not read the uploaded file.' }, { status: 400 })
    }
    text = (await data.text()).trim()
  }

  if (!text) {
    return Response.json({ error: 'Paste the research report or upload a file first.' }, { status: 400 })
  }

  let truncated = false
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS)
    truncated = true
  }

  // 1. Map the package into a unified record via Gemini.
  let extraction: EmailIntakeExtraction
  try {
    const { data } = await callGemini<Partial<EmailIntakeExtraction> | string>({
      task: 'email-intake',
      systemPrompt: EMAIL_INTAKE_SYSTEM_PROMPT,
      userMessage: text,
      userId,
      promptVersion: EMAIL_INTAKE_PROMPT_VERSION,
      maxTokens: 8192,
    })
    if (!data || typeof data !== 'object') {
      return Response.json({ error: 'The AI could not parse this report. Try a cleaner paste.' }, { status: 422 })
    }
    extraction = normalize(data as Partial<EmailIntakeExtraction>)
  } catch (err) {
    console.error('Email intake analyze failed:', err)
    return Response.json({ error: 'AI analysis failed. Check the Gemini key and try again.' }, { status: 500 })
  }

  // 2. Reuse existing matchers + fit assessment (all non-fatal).
  const proposalShape = toProposalExtraction(extraction)
  const [matchCandidates, partyMatches, fitAssessment] = await Promise.all([
    findMatchingProjects(proposalShape.projects).catch(() => []),
    matchExtractedParties(proposalShape.parties).catch(() => []),
    assessFit(proposalShape, userId).catch(() => null),
  ])

  // 3. Stage the session for review.
  const { data: session, error } = await supabase
    .from('email_intake_sessions')
    .insert({
      user_id: userId === SYSTEM_USER_ID ? null : userId,
      status: 'pending',
      label,
      raw_text: text,
      extraction_result: extraction as unknown as never,
      match_candidates: matchCandidates as unknown as never,
      party_matches: partyMatches as unknown as never,
      fit_assessment: (fitAssessment ?? null) as unknown as never,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Stage email intake session failed:', error)
    return Response.json({ error: `Could not stage the session: ${error.message}` }, { status: 500 })
  }

  return Response.json({
    session_id: session.id,
    extraction,
    match_candidates: matchCandidates,
    party_matches: partyMatches,
    fit_assessment: fitAssessment,
    truncated,
  })
}
