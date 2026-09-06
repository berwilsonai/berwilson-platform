/**
 * The due-diligence checklist a website deal submission answers.
 *
 * ONE definition, in code, deliberately: the website form is built from a copy
 * of this list, and the platform maps answers back to `dd_items` by key. A
 * database-backed template was rejected because the form cannot read a
 * tailnet-only platform — it would have to be published to Drive first, which is
 * a moving part in exchange for nothing.
 *
 * `category` and `severity` are the values the Diligence tab already filters on,
 * so an imported checklist is indistinguishable from one typed by hand. Change a
 * question here and in the form; an answer arriving under an unknown key still
 * becomes a diligence item (category `other`), so drift is visible rather than
 * silently dropped.
 */

import type { DdSeverity } from '@/lib/supabase/types'

export interface ChecklistItem {
  /** Stable key. The form sends this; renaming one orphans its answers. */
  key: string
  /** The question, and the text of the dd_item it becomes. */
  label: string
  /** A dd_items.category value — see DD_CATEGORIES in DiligenceTab. */
  category: string
  /** How loudly a missing answer should read on the Diligence tab. */
  severity: DdSeverity
  /**
   * Whether a missing answer is worth an open diligence item. Optional
   * questions left blank create nothing — a checklist that manufactures
   * twenty open items on day one is a checklist nobody reads.
   */
  required: boolean
}

export const DEAL_CHECKLIST: ChecklistItem[] = [
  // ── Site ──────────────────────────────────────────────────────────────────
  { key: 'site_address', label: 'Site address and parcel numbers', category: 'site', severity: 'blocker', required: true },
  { key: 'site_acreage', label: 'Site acreage and buildable area', category: 'site', severity: 'critical', required: true },
  { key: 'site_control', label: 'Site control — owned, under contract, or LOI', category: 'site', severity: 'blocker', required: true },
  { key: 'site_survey', label: 'ALTA survey available', category: 'site', severity: 'watch', required: false },
  { key: 'site_utilities', label: 'Utilities to the site — water, sewer, power, gas', category: 'site', severity: 'critical', required: true },
  { key: 'site_access', label: 'Road access and frontage', category: 'site', severity: 'watch', required: false },

  // ── Title ─────────────────────────────────────────────────────────────────
  { key: 'title_report', label: 'Preliminary title report', category: 'title', severity: 'critical', required: true },
  { key: 'title_encumbrances', label: 'Easements, liens, or encumbrances of record', category: 'title', severity: 'critical', required: true },

  // ── Regulatory ────────────────────────────────────────────────────────────
  { key: 'zoning_current', label: 'Current zoning and permitted use', category: 'regulatory', severity: 'blocker', required: true },
  { key: 'zoning_entitlements', label: 'Entitlements required and their status', category: 'regulatory', severity: 'blocker', required: true },
  { key: 'permit_timeline', label: 'Expected permitting timeline', category: 'regulatory', severity: 'watch', required: false },
  { key: 'impact_fees', label: 'Impact fees and municipal exactions', category: 'regulatory', severity: 'watch', required: false },

  // ── Environmental ─────────────────────────────────────────────────────────
  { key: 'env_phase_one', label: 'Phase I environmental site assessment', category: 'environmental', severity: 'critical', required: true },
  { key: 'env_geotech', label: 'Geotechnical report', category: 'environmental', severity: 'watch', required: false },
  { key: 'env_floodplain', label: 'Floodplain, wetlands, or protected habitat', category: 'environmental', severity: 'critical', required: true },

  // ── Financial ─────────────────────────────────────────────────────────────
  { key: 'fin_capital_stack', label: 'Capital stack — debt, equity, and sources', category: 'financial', severity: 'blocker', required: true },
  { key: 'fin_proforma', label: 'Development pro forma', category: 'financial', severity: 'critical', required: true },
  { key: 'fin_hard_costs', label: 'Hard cost estimate and basis', category: 'financial', severity: 'critical', required: true },
  { key: 'fin_ber_role', label: 'What Ber Wilson is being asked to provide — capital, GC, or both', category: 'financial', severity: 'blocker', required: true },
  { key: 'fin_returns', label: 'Target returns and hold period', category: 'financial', severity: 'watch', required: false },

  // ── Market ────────────────────────────────────────────────────────────────
  { key: 'market_demand', label: 'Demand evidence — comps, LOIs, or pre-leasing', category: 'market', severity: 'critical', required: true },
  { key: 'market_study', label: 'Third-party market study', category: 'market', severity: 'info', required: false },

  // ── Partner ───────────────────────────────────────────────────────────────
  { key: 'partner_entity', label: 'Sponsor entity and ownership', category: 'partner_dd', severity: 'critical', required: true },
  { key: 'partner_track_record', label: 'Sponsor track record on comparable projects', category: 'partner_dd', severity: 'critical', required: true },
  { key: 'partner_references', label: 'References — lender, GC, or municipal', category: 'partner_dd', severity: 'watch', required: false },

  // ── Legal ─────────────────────────────────────────────────────────────────
  { key: 'legal_structure', label: 'Proposed deal structure — JV, fee build, or equity', category: 'legal', severity: 'blocker', required: true },
  { key: 'legal_litigation', label: 'Pending litigation touching the site or sponsor', category: 'legal', severity: 'critical', required: true },

  // ── Bonding ───────────────────────────────────────────────────────────────
  // Bonding is the single most-cited gap in the lead backlog and the company
  // ceiling is $20M, so it is asked up front rather than discovered late.
  { key: 'bonding_required', label: 'Surety bonding required, and at what value', category: 'bonding', severity: 'blocker', required: true },
]

export const CHECKLIST_BY_KEY: Record<string, ChecklistItem> = Object.fromEntries(
  DEAL_CHECKLIST.map((item) => [item.key, item])
)

/** Categories this checklist can produce, for the Diligence tab's filter row. */
export const CHECKLIST_CATEGORIES = Array.from(
  new Set(DEAL_CHECKLIST.map((i) => i.category))
).sort()
