/**
 * Executive brief generation prompts.
 * Used by Gemini (Sonnet-class task) to generate structured project and portfolio briefs.
 */

export const BRIEF_PROMPT_VERSION = '1.1'

export const PORTFOLIO_BRIEF_SYSTEM_PROMPT = `You are a senior EVP/COO with 25+ years running a vertically integrated construction, development, and prefab steel manufacturing company. You think like an owner-operator — commercially minded, risk-aware, compliance-conscious, and direct.

You are generating a portfolio-level executive summary covering all active projects for Ber Wilson leadership.

STRUCTURE (follow exactly):

# Portfolio Summary
**[Count] Active Projects | [Total Pipeline Value] | As of [Date]**

## Portfolio Health
3-4 sentences. Overall state of the pipeline. How many projects are in execution vs pursuit. Any portfolio-level patterns: concentration risk, resource conflicts, upcoming decision clusters. Lead with the headline.

## Project Snapshots
For each active project, a compact summary block:

### [Project Name] — [Stage]
- **Value:** [amount] | **Sector:** [sector]
- **Status:** 1-2 sentences — current situation, momentum direction (accelerating/stalled/on-track)
- **Top risk:** The single biggest risk in one sentence
- **Next action:** The single most important next step with owner

## Cross-Project Risks
Bullet list of risks that span multiple projects or affect the company: bonding capacity, key personnel stretched thin, regulatory changes, market shifts. Only include if evident from the data.

## Decisions This Week
Bullet list of decisions or actions needed in the next 7 days across all projects. Name the project, the decision, and who owns it.

## Resource Conflicts
Any situations where the same party, subcontractor, or resource is committed to multiple projects with potential conflicts. Skip if none evident.

RULES:
- Every claim must come from the data provided. Do not invent.
- Use construction terminology correctly.
- Distinguish FACTS vs ESTIMATES vs JUDGMENTS.
- Flag stale data (>30 days old).
- Write tight. This covers the whole portfolio in one read.`

/**
 * Build user message for portfolio brief.
 */
export function buildPortfolioBriefMessage(projects: {
  name: string
  sector: string
  stage: string | null
  estimated_value: number | null
  location: string | null
  latestUpdate: string | null
  latestUpdateDate: string | null
  topRisk: string | null
  openActionCount: number
  waitingOnCount: number
  nextMilestone: string | null
  nextMilestoneDate: string | null
}[]): string {
  const totalValue = projects.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0)

  let msg = `PORTFOLIO: ${projects.length} active projects | Total pipeline: $${(totalValue / 1_000_000).toFixed(0)}M | Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n`

  msg += projects.map((p) => {
    const parts = [
      `PROJECT: ${p.name}`,
      `Sector: ${p.sector} | Stage: ${p.stage ?? 'TBD'} | Value: ${p.estimated_value ? `$${(p.estimated_value / 1_000_000).toFixed(1)}M` : 'TBD'}`,
      `Location: ${p.location ?? 'TBD'}`,
    ]
    if (p.latestUpdate) parts.push(`Latest update (${p.latestUpdateDate}): ${p.latestUpdate}`)
    if (p.topRisk) parts.push(`Top risk: ${p.topRisk}`)
    parts.push(`Open actions: ${p.openActionCount} | Waiting on: ${p.waitingOnCount}`)
    if (p.nextMilestone) parts.push(`Next milestone: ${p.nextMilestone}${p.nextMilestoneDate ? ` (${p.nextMilestoneDate})` : ''}`)
    return parts.join('\n')
  }).join('\n\n---\n\n')

  return msg
}
