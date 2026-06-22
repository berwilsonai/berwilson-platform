import { createAdminClient } from '@/lib/supabase/admin'
import { SECTOR_LABELS } from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'

/**
 * Single source of truth for turning the Ber Wilson company profile into a
 * prompt-ready context block. Used by the executive agent (qualifications
 * context) and the proposal-intake fit assessment so both judge opportunities
 * against the same picture of the company.
 */

export interface CompanyContext {
  /** Markdown block to append to a system prompt. */
  text: string
  /** True once the pursuit profile has enough detail to judge fit. */
  hasPursuitProfile: boolean
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function sectorLabel(s: string): string {
  return SECTOR_LABELS[s as ProjectSector] ?? s
}

function valueRange(min: number | null, sweet: number | null, max: number | null): string {
  if (min == null && sweet == null && max == null) return '—'
  const lo = min != null ? fmtUsd(min) : '—'
  const hi = max != null ? fmtUsd(max) : '—'
  const range = `${lo} to ${hi}`
  return sweet != null ? `${range} (sweet spot ${fmtUsd(sweet)})` : range
}

export async function getCompanyContext(): Promise<CompanyContext | null> {
  const supabase = createAdminClient()

  const [{ data: p }, { data: certs }] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).single(),
    supabase
      .from('certifications')
      .select('name, issuing_body, expiration_date')
      .eq('is_active', true)
      .order('name'),
  ])

  if (!p) return null

  const diversity = [
    p.dbe_certified && 'DBE',
    p.mbe_certified && 'MBE',
    p.wbe_certified && 'WBE',
    p.sbe_certified && 'SBE',
  ].filter(Boolean).join(', ')

  const certList = (certs ?? [])
    .map(c => `  - ${c.name}${c.issuing_body ? ` (${c.issuing_body})` : ''}${c.expiration_date ? `, expires ${c.expiration_date}` : ''}`)
    .join('\n')

  const sectors = (p.target_sectors ?? []).map(sectorLabel)

  // The pursuit profile is "usable" once there's at least a sector list or a
  // value range to judge against — otherwise fit assessment is guesswork.
  const hasPursuitProfile =
    sectors.length > 0 ||
    p.min_project_value != null ||
    p.max_project_value != null ||
    !!p.disqualifiers ||
    !!p.differentiators

  const lines: string[] = []
  lines.push('## BER WILSON COMPANY PROFILE')
  lines.push(`- **Legal Name:** ${p.legal_name}${p.dba_name ? ` (dba ${p.dba_name})` : ''}`)
  if (p.founded_year) lines.push(`- **Founded:** ${p.founded_year}`)
  if (p.hq_address) lines.push(`- **HQ:** ${p.hq_address}`)
  if (p.about) lines.push(`- **About:** ${p.about.slice(0, 600)}`)
  if (p.capabilities) lines.push(`- **Capabilities:** ${p.capabilities.slice(0, 600)}`)
  if ((p.naics_codes ?? []).length) lines.push(`- **NAICS Codes:** ${p.naics_codes.join(', ')}`)
  lines.push(`- **Diversity Status:** ${diversity || 'None certified'}`)
  lines.push(`- **Bonding:** single project ${fmtUsd(p.bonding_capacity)} / aggregate ${fmtUsd(p.aggregate_bonding)}${p.bonding_company ? ` via ${p.bonding_company}` : ''}`)
  if (p.annual_revenue != null) lines.push(`- **Annual Revenue:** ${fmtUsd(p.annual_revenue)}`)

  lines.push('')
  lines.push('### Pursuit Profile (what Ber Wilson actively goes after)')
  lines.push(`- **Target Sectors:** ${sectors.length ? sectors.join(', ') : 'Not set'}`)
  lines.push(`- **Project Size:** ${valueRange(p.min_project_value, p.sweet_spot_value, p.max_project_value)}`)
  lines.push(`- **Target Geographies:** ${(p.target_geographies ?? []).join(', ') || 'Not set'}`)
  lines.push(`- **Delivery Methods:** ${(p.delivery_methods ?? []).join(', ') || 'Not set'}`)
  lines.push(`- **Contract Vehicles:** ${(p.contract_types ?? []).join(', ') || 'Not set'}`)
  if (p.differentiators) lines.push(`- **Differentiators / Win Themes:** ${p.differentiators.slice(0, 600)}`)
  if (p.past_performance) lines.push(`- **Relevant Past Performance:** ${p.past_performance.slice(0, 600)}`)
  if (p.disqualifiers) lines.push(`- **Disqualifiers (hard no-go):** ${p.disqualifiers.slice(0, 600)}`)
  if (p.pursuit_notes) lines.push(`- **Current Appetite Notes:** ${p.pursuit_notes.slice(0, 600)}`)

  lines.push('')
  lines.push(`### Active Certifications (${(certs ?? []).length})`)
  lines.push(certList || '  (none on file)')

  return { text: lines.join('\n'), hasPursuitProfile }
}
