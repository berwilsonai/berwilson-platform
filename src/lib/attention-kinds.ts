/**
 * The attention registry, and nothing that touches a database.
 *
 * ⚠ ITS OWN MODULE BECAUSE A CLIENT COMPONENT READS IT. `attention.ts` imports
 * the service-role Supabase client and the leads client; importing the registry
 * from there would drag all of that into the browser bundle. §12 states the
 * mirror of this rule (a helper shared with a server page must not live in a
 * `'use client'` file) and the same reasoning runs the other way.
 */

/**
 * THE REGISTRY OF ATTENTION KINDS. One row per thing that can need you.
 *
 * ⚠ EVERYTHING KEYED BY KIND DERIVES FROM HERE — the category union, the
 * summary's field names, the counts, and the filter chips on /attention. It
 * used to be three hand-written lists: a union of ten strings, eleven lines
 * building the summary, and (had the UI existed) a third in the component. §12
 * records exactly this shape twice over — a hand-written enumeration beside a
 * registry drifts, and `/decide` shipped a kind that got a count and no chip
 * because of it. A new kind added here appears everywhere or nowhere.
 *
 * ⚠ THERE IS DELIBERATELY NO `counted` FLAG HERE. What the sidebar badge sums
 * is a separate and narrower question, and `COUNTED_ATTENTION_KINDS` below
 * already answers it — in the badge's own vocabulary, which is NOT this one:
 * the badge head-counts `certifications` (a company record) while this
 * registry's `expiring_compliance` reads `compliance_items` (a project child).
 * Two near-identical names over two different tables. Putting a second answer
 * in this row would be the drift this registry exists to prevent, so the two
 * vocabularies stay apart and each says so.
 *
 * `label` is what a reader sees. `tone` comes from src/lib/ui/tone.ts, so the
 * chips cannot invent a colour.
 */
export const ATTENTION_KINDS = [
  { category: 'overdue_action',       summaryKey: 'overdue_actions',       label: 'Overdue tasks',        tone: 'critical' },
  { category: 'critical_dd',          summaryKey: 'critical_dd',           label: 'Critical diligence',   tone: 'critical' },
  { category: 'approaching_milestone',summaryKey: 'approaching_milestones',label: 'Milestones',           tone: 'caution' },
  { category: 'expiring_compliance',  summaryKey: 'expiring_compliance',   label: 'Compliance',           tone: 'caution' },
  { category: 'stale_waiting',        summaryKey: 'stale_waiting',         label: 'Waiting on someone',   tone: 'caution' },
  { category: 'stale_decision',       summaryKey: 'stale_decisions',       label: 'Decisions adrift',     tone: 'info' },
  { category: 'dependency_risk',      summaryKey: 'dependency_risks',      label: 'Dependency risk',      tone: 'critical' },
  { category: 'investor_followup',    summaryKey: 'investor_followups',    label: 'Investor follow-ups',  tone: 'info' },
  { category: 'dino_payment',         summaryKey: 'dino_payments',         label: 'Dino payments',        tone: 'info' },
  { category: 'lead_review',          summaryKey: 'lead_reviews',          label: 'Inbound leads',        tone: 'neutral' },
] as const

export type AttentionCategory = (typeof ATTENTION_KINDS)[number]['category']
type AttentionSummaryKey = (typeof ATTENTION_KINDS)[number]['summaryKey']

export function attentionKind(category: AttentionCategory) {
  const k = ATTENTION_KINDS.find((x) => x.category === category)
  if (!k) throw new Error(`Unknown attention category: ${category}`)
  return k
}

/** Derived from the registry: a new kind cannot get a count and no field. */
export type AttentionSummary = { total: number } & Record<AttentionSummaryKey, number>

/**
 * Where an item sends the reader.
 *
 * ⚠ ONLY DESTINATIONS THAT EXIST, AND AN HONEST FALLBACK. Several of these
 * records have no page of their own — a compliance item is a child rendered
 * inside a register, a stale decision lives in an update's jsonb — so the link
 * goes to the nearest page that can actually answer the question rather than to
 * a URL assembled from a table name, which would be a second routing table
 * drifting beside the real one (§12, same call as `/decide`).
 *
 * `projectId` is null for the kinds that are not project children at all
 * (investor, Dino, lead), which is why every arm has to tolerate it.
 */
export function attentionHref(category: AttentionCategory, projectId: string | null): string {
  const onProject = (tab: string) => (projectId ? `/projects/${projectId}/${tab}` : '/projects')
  switch (category) {
    case 'overdue_action':
      return '/tasks'
    case 'critical_dd':
      return onProject('diligence')
    case 'approaching_milestone':
      return onProject('milestones')
    case 'stale_waiting':
    case 'stale_decision':
      return onProject('updates')
    case 'dependency_risk':
      return projectId ? `/projects/${projectId}` : '/projects'
    // Compliance items hang off a project but are read in the company register,
    // which is the only screen that lists them with their due dates.
    case 'expiring_compliance':
      return '/company/compliance'
    case 'investor_followup':
      return '/investors'
    case 'dino_payment':
      return '/dino'
    case 'lead_review':
      return '/leads'
  }
}

/** Urgency bands. Colour is reserved for what is still actionable (§12). */
export function urgencyBand(urgency: number): 'now' | 'soon' | 'watch' {
  if (urgency >= 75) return 'now'
  if (urgency >= 50) return 'soon'
  return 'watch'
}
