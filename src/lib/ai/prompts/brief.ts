/**
 * Executive brief generation prompts.
 * Used by Gemini (Sonnet-class task) to generate structured project and portfolio briefs.
 */

export const BRIEF_PROMPT_VERSION = '1.0'

export const PROJECT_BRIEF_SYSTEM_PROMPT = `You are a senior EVP/COO with 25+ years running a vertically integrated construction, development, and prefab steel manufacturing company. You think like an owner-operator — commercially minded, risk-aware, compliance-conscious, and direct. You do not pad, hedge, or use filler. You write briefs that could go directly to a board or PE partner.

You are generating a one-page executive project brief for Ber Wilson leadership.

STRUCTURE (follow exactly):

# [Project Name]
**[Sector] | [Stage] | [Estimated Value] | [Location]**

## Situation
2-3 sentences. Current state of the project — what's happening right now, where it sits in the pipeline, any key context. Lead with the most important thing. Use present tense.

## Key Risks & Open Items
Bullet list. Each item starts with severity in brackets: [CRITICAL], [WATCH], or [INFO]. Be specific — name the party, the dollar amount, the date, the regulation. Do not list vague risks like "schedule may slip."

## Action Items
Bullet list. Each item names the owner and the deadline (if known). Only include items that are actually open/pending. Format: "- [Owner] — Action description (by [date])"

## Waiting On
Bullet list. What decisions, approvals, or deliverables are pending from external parties. Name the party and how long it's been pending if known.

## Financing Status
2-3 sentences. Capital stack summary: senior debt, equity, mezz if applicable. Draw status. Any financing risks. Skip this section entirely if no financing data is available.

## Compliance Status
2-3 sentences. Key compliance items and their status: CMMC, Davis-Bacon, bonding, DBE/EEO, licenses. Only mention items that are in progress or have issues. Skip if all compliant or no data.

## Next Decision Point
1-2 sentences. The single most important upcoming decision or gate. When it needs to happen and what depends on it.

RULES:
- Every claim must come from the data provided. Do not invent.
- If data is missing for a section, write "No data available" — do not fabricate.
- Use construction terminology correctly: NTP, RFI, CO, PCO, GMP, FFP, CPFF, T&M, CMAR, etc.
- Distinguish FACTS (from data) vs ESTIMATES (projections) vs JUDGMENTS (your synthesis).
- Flag stale data: if the most recent update is >30 days old, note it.
- Write tight. This is a one-pager. Executives read fast.`

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
 * Build user message for a single project brief.
 */
export function buildProjectBriefMessage(project: {
  name: string
  sector: string
  stage: string | null
  status: string | null
  estimated_value: number | null
  location: string | null
  contract_type: string | null
  delivery_method: string | null
  solicitation_number: string | null
  updates: { summary: string | null; action_items: unknown[]; waiting_on: unknown[]; risks: unknown[]; decisions: unknown[]; created_at: string | null }[]
  milestones: { label: string; stage: string; target_date: string | null; completed_at: string | null }[]
  dd_items: { category: string; item: string; status: string | null; severity: string | null; notes: string | null }[]
  financing: { structure_type: string | null; senior_debt: number | null; equity_amount: number | null; equity_pct: number | null; lender: string | null; pe_partner: string | null; notes: string | null }[]
  compliance: { framework: string; requirement: string; status: string | null; due_date: string | null; notes: string | null }[]
  players: { full_name: string; company: string | null; role: string }[]
}): string {
  const sections: string[] = []

  sections.push(`PROJECT: ${project.name}
Sector: ${project.sector} | Stage: ${project.stage ?? 'TBD'} | Status: ${project.status ?? 'TBD'}
Value: ${project.estimated_value ? `$${(project.estimated_value / 1_000_000).toFixed(1)}M` : 'TBD'}
Location: ${project.location ?? 'TBD'}
Contract: ${project.contract_type ?? 'TBD'} | Delivery: ${project.delivery_method ?? 'TBD'}
${project.solicitation_number ? `Solicitation: ${project.solicitation_number}` : ''}`)

  if (project.players.length > 0) {
    sections.push('KEY PLAYERS:\n' + project.players.map((p) =>
      `- ${p.full_name}${p.company ? ` (${p.company})` : ''} — ${p.role}`
    ).join('\n'))
  }

  if (project.updates.length > 0) {
    sections.push('RECENT UPDATES (newest first):\n' + project.updates.map((u) => {
      const date = u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'
      const parts = [`[${date}] ${u.summary ?? '(no summary)'}`]
      if (u.action_items?.length) parts.push(`  Action items: ${JSON.stringify(u.action_items)}`)
      if (u.waiting_on?.length) parts.push(`  Waiting on: ${JSON.stringify(u.waiting_on)}`)
      if (u.risks?.length) parts.push(`  Risks: ${JSON.stringify(u.risks)}`)
      if (u.decisions?.length) parts.push(`  Decisions: ${JSON.stringify(u.decisions)}`)
      return parts.join('\n')
    }).join('\n\n'))
  }

  if (project.milestones.length > 0) {
    sections.push('MILESTONES:\n' + project.milestones.map((m) =>
      `- ${m.label} (${m.stage}) — Target: ${m.target_date ?? 'TBD'} | ${m.completed_at ? `Completed ${m.completed_at}` : 'Pending'}`
    ).join('\n'))
  }

  if (project.dd_items.length > 0) {
    sections.push('DUE DILIGENCE:\n' + project.dd_items.map((d) =>
      `- [${(d.severity ?? 'info').toUpperCase()}] ${d.category}: ${d.item} — ${d.status ?? 'unknown'}${d.notes ? ` (${d.notes})` : ''}`
    ).join('\n'))
  }

  if (project.financing.length > 0) {
    sections.push('FINANCING:\n' + project.financing.map((f) => {
      const parts = [f.structure_type ?? 'Unknown structure']
      if (f.senior_debt) parts.push(`Senior: $${(f.senior_debt / 1_000_000).toFixed(1)}M`)
      if (f.equity_amount) parts.push(`Equity: $${(f.equity_amount / 1_000_000).toFixed(1)}M (${f.equity_pct ?? '?'}%)`)
      if (f.lender) parts.push(`Lender: ${f.lender}`)
      if (f.pe_partner) parts.push(`PE: ${f.pe_partner}`)
      if (f.notes) parts.push(`Notes: ${f.notes}`)
      return `- ${parts.join(' | ')}`
    }).join('\n'))
  }

  if (project.compliance.length > 0) {
    sections.push('COMPLIANCE:\n' + project.compliance.map((c) =>
      `- ${c.framework}: ${c.requirement} — ${c.status ?? 'unknown'}${c.due_date ? ` (due ${c.due_date})` : ''}${c.notes ? ` — ${c.notes}` : ''}`
    ).join('\n'))
  }

  return sections.join('\n\n---\n\n')
}

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
