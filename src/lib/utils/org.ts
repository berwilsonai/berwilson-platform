/**
 * Constants for the org structure / entity architecture chart
 * (/company/structure) — node kinds, capital entity types, roster tiers, and
 * person status. Stored as text in the DB (no Postgres enums), so this file is
 * the source of truth for the allowed values and how they render.
 */

// ─── Node kind ───────────────────────────────────────────────────────────────

export type OrgNodeKind = 'arm' | 'management' | 'division' | 'spv'

export const ORG_NODE_KINDS: OrgNodeKind[] = ['arm', 'management', 'division', 'spv']

export function orgNodeKind(value: string | null | undefined): OrgNodeKind {
  return ORG_NODE_KINDS.includes(value as OrgNodeKind)
    ? (value as OrgNodeKind)
    : 'spv'
}

// ─── Entity type (divisions + SPVs; arms carry free text) ────────────────────

export type OrgEntityType = 'series' | 'standalone'

export const ORG_ENTITY_TYPES: OrgEntityType[] = ['series', 'standalone']

export const ORG_ENTITY_TYPE_LABELS: Record<OrgEntityType, string> = {
  series: 'Series (internal capital)',
  standalone: 'Standalone LLC (outside capital)',
}

export const ORG_ENTITY_TYPE_SHORT: Record<OrgEntityType, string> = {
  series: 'Series',
  standalone: 'Standalone',
}

// Standalone = outside capital, the distinction that matters — it gets the
// warm tone; series stays muted.
export const ORG_ENTITY_BADGE: Record<OrgEntityType, string> = {
  series: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  standalone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
}

export function orgEntityType(value: string | null | undefined): OrgEntityType | null {
  return ORG_ENTITY_TYPES.includes(value as OrgEntityType)
    ? (value as OrgEntityType)
    : null
}

// ─── Roster tier (people with no node — the leadership roster) ───────────────

export type OrgTier = 'leadership' | 'director'

export const ORG_TIERS: OrgTier[] = ['leadership', 'director']

export const ORG_TIER_LABELS: Record<OrgTier, string> = {
  leadership: 'Senior Leadership',
  director: 'Directors',
}

export function orgTier(value: string | null | undefined): OrgTier | null {
  return ORG_TIERS.includes(value as OrgTier) ? (value as OrgTier) : null
}

// ─── Grouping (shared by the chart renderer + print view) ────────────────────

import type { OrgNode, OrgPerson } from '@/lib/supabase/types'

export interface OrgGroups {
  arms: OrgNode[]
  management: OrgNode | null
  divisions: OrgNode[]
  spvsByDivision: Map<string, OrgNode[]>
  roster: Record<OrgTier, OrgPerson[]>
  staffByNode: Map<string, OrgPerson[]>
}

const bySort = (
  a: { sort_order: number; created_at: string | null },
  b: { sort_order: number; created_at: string | null },
) => a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? '')

/** Group flat org rows into the render structure. Pure — server-safe. */
export function groupOrg(nodes: OrgNode[], people: OrgPerson[]): OrgGroups {
  const arms = nodes.filter((n) => n.kind === 'arm').sort(bySort)
  const management = nodes.find((n) => n.kind === 'management') ?? null
  const divisions = nodes.filter((n) => n.kind === 'division').sort(bySort)

  const spvsByDivision = new Map<string, OrgNode[]>()
  for (const d of divisions) spvsByDivision.set(d.id, [])
  for (const n of nodes) {
    if (n.kind !== 'spv' || !n.parent_id) continue
    spvsByDivision.get(n.parent_id)?.push(n)
  }
  for (const list of spvsByDivision.values()) list.sort(bySort)

  const roster: Record<OrgTier, OrgPerson[]> = { leadership: [], director: [] }
  const staffByNode = new Map<string, OrgPerson[]>()
  for (const p of people) {
    if (p.node_id) {
      const list = staffByNode.get(p.node_id) ?? []
      list.push(p)
      staffByNode.set(p.node_id, list)
    } else {
      roster[p.tier === 'leadership' ? 'leadership' : 'director'].push(p)
    }
  }
  roster.leadership.sort(bySort)
  roster.director.sort(bySort)
  for (const list of staffByNode.values()) list.sort(bySort)

  return { arms, management, divisions, spvsByDivision, roster, staffByNode }
}

// ─── Person status ───────────────────────────────────────────────────────────

export type OrgPersonStatus = 'active' | 'open'

export const ORG_PERSON_STATUSES: OrgPersonStatus[] = ['active', 'open']

export function orgPersonStatus(value: string | null | undefined): OrgPersonStatus {
  return value === 'open' ? 'open' : 'active'
}
