import { callGemini } from '@/lib/ai/gemini'
import { getCompanyContext } from '@/lib/ai/company-context'
import type { ProposalExtraction } from '@/lib/ai/proposal-matching'

export const FIT_ASSESSMENT_PROMPT_VERSION = 'fit-assessment-1.0'

export type FitRecommendation = 'pursue' | 'consider' | 'pass'

export interface FitAssessment {
  recommendation: FitRecommendation
  /** 0–100 overall fit against Ber Wilson's appetite and capabilities. */
  fit_score: number
  /** One-paragraph executive read on whether this is worth pursuing. */
  summary: string
  /** Why it fits — capability/sector/size/geography alignment. */
  strengths: string[]
  /** Risks or reasons for caution specific to this opportunity. */
  concerns: string[]
  /** Capability, bonding, certification, or qualification gaps to close. */
  gaps: string[]
  /** The decisions/questions the executives must resolve before committing. */
  key_questions: string[]
  /** True when the company pursuit profile was too thin to judge confidently. */
  profile_incomplete: boolean
}

const SYSTEM_PROMPT = `You are the capture director for Ber Wilson, a vertically integrated construction, development, and prefab steel manufacturing company. You decide whether an inbound opportunity is worth the firm's limited pursuit capacity.

You will be given (1) Ber Wilson's company profile and pursuit criteria, and (2) an extracted summary of an inbound opportunity. Judge fit through four lenses:
- Commercial: does it match the target sectors, size, geography, and contract vehicles? Can we realistically win it?
- Operational: can we deliver it with our capabilities and delivery methods?
- Financial: is it within bonding capacity and a sensible margin profile?
- Compliance: do we hold (or can we get) the required certifications/qualifications? Any disqualifiers triggered?

Be decisive and honest. If the opportunity trips a stated disqualifier, lean toward "pass". If the company profile lacks the detail needed to judge a dimension, say so in gaps/key_questions and set profile_incomplete=true rather than guessing.

Return ONLY valid JSON matching exactly this shape:
{
  "recommendation": "pursue" | "consider" | "pass",
  "fit_score": 0-100,
  "summary": "one paragraph",
  "strengths": ["..."],
  "concerns": ["..."],
  "gaps": ["..."],
  "key_questions": ["..."],
  "profile_incomplete": true | false
}
No markdown, no explanation outside the JSON.`

function summarizeOpportunity(extraction: ProposalExtraction): string {
  const lines: string[] = []
  lines.push(`Document type: ${extraction.document_type}`)
  if (extraction.intake_summary) lines.push(`Summary: ${extraction.intake_summary}`)
  if (extraction.developer_company?.name) {
    lines.push(`Developer/Client: ${extraction.developer_company.name}${extraction.developer_company.location ? ` (${extraction.developer_company.location})` : ''}`)
  }
  for (const [idx, p] of (extraction.projects ?? []).entries()) {
    const bits = [
      p.name && `Name: ${p.name}`,
      p.sector && `Sector: ${p.sector}`,
      p.estimated_value != null && `Value: $${p.estimated_value.toLocaleString()}`,
      p.location && `Location: ${p.location}`,
      p.contract_type && `Contract: ${p.contract_type}`,
      p.delivery_method && `Delivery: ${p.delivery_method}`,
      p.scope_of_work && `Scope: ${p.scope_of_work.slice(0, 400)}`,
    ].filter(Boolean).join(' | ')
    lines.push(`Project ${idx + 1}: ${bits}`)
  }
  if (extraction.compliance_requirements?.length) {
    lines.push(`Compliance requirements: ${extraction.compliance_requirements.join(', ')}`)
  }
  if (extraction.bonding_required != null) {
    lines.push(`Bonding required: ${extraction.bonding_required ? 'yes' : 'no'}`)
  }
  if (extraction.risks?.length) {
    lines.push(`Noted risks: ${extraction.risks.map(r => r.text).join('; ')}`)
  }
  return lines.join('\n')
}

/**
 * Assess whether an inbound opportunity fits Ber Wilson, scoring it against the
 * company profile + pursuit criteria. Returns null if no company profile exists.
 */
export async function assessFit(
  extraction: ProposalExtraction,
  userId: string
): Promise<FitAssessment | null> {
  const company = await getCompanyContext()
  if (!company) return null

  const userMessage = `${company.text}

---

## INBOUND OPPORTUNITY
${summarizeOpportunity(extraction)}

${company.hasPursuitProfile
    ? 'Assess the fit and give a recommendation.'
    : 'NOTE: The pursuit profile is sparse — judge what you can from capabilities/bonding, flag the missing criteria in gaps/key_questions, and set profile_incomplete=true.'}`

  const { data } = await callGemini<FitAssessment | string>({
    task: 'fit-assessment',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    userId,
    promptVersion: FIT_ASSESSMENT_PROMPT_VERSION,
    maxTokens: 1500,
  })

  if (!data || typeof data !== 'object') return null

  // Normalize / guard the model output.
  const a = data as FitAssessment
  const rec: FitRecommendation =
    a.recommendation === 'pursue' || a.recommendation === 'pass' ? a.recommendation : 'consider'
  return {
    recommendation: rec,
    fit_score: typeof a.fit_score === 'number' ? Math.max(0, Math.min(100, Math.round(a.fit_score))) : 50,
    summary: a.summary ?? '',
    strengths: Array.isArray(a.strengths) ? a.strengths : [],
    concerns: Array.isArray(a.concerns) ? a.concerns : [],
    gaps: Array.isArray(a.gaps) ? a.gaps : [],
    key_questions: Array.isArray(a.key_questions) ? a.key_questions : [],
    profile_incomplete: a.profile_incomplete ?? !company.hasPursuitProfile,
  }
}
