// Raise helpers — tranche parsing, sequential waterfall fill, and shared
// validation for raise writes (used by POST /api/raises and PATCH
// /api/raises/[id]; route files can't export helpers).
//
// Tranches are TARGETS, not ledger rows: investors commit to the raise, and
// tranches fill sequentially from the raise's cumulative money levels.

import type { TablesInsert } from '@/lib/supabase/types'
import { RAISE_STATUSES } from '@/lib/utils/investors'

// ─── Tranches ────────────────────────────────────────────────────────────────

export interface RaiseTranche {
  label: string
  amount: number
  target_date: string | null
}

export const MAX_TRANCHES = 24

/** Tolerant parse of the raises.tranches jsonb column. */
export function parseTranches(json: unknown): RaiseTranche[] {
  if (!Array.isArray(json)) return []
  const out: RaiseTranche[] = []
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue
    const t = item as Record<string, unknown>
    const amount = typeof t.amount === 'number' ? t.amount : parseFloat(String(t.amount ?? ''))
    if (isNaN(amount) || amount <= 0) continue
    out.push({
      label: typeof t.label === 'string' && t.label.trim() !== '' ? t.label.trim() : `Tranche ${out.length + 1}`,
      amount,
      target_date: typeof t.target_date === 'string' && t.target_date !== '' ? t.target_date : null,
    })
  }
  return out.slice(0, MAX_TRANCHES)
}

// ─── Money levels ────────────────────────────────────────────────────────────

export interface MoneyTriple {
  amount_indicated: number | null
  amount_committed: number | null
  amount_funded: number | null
}

export interface RaiseLevels {
  /** Wired dollars. */
  funded: number
  /** Signed dollars (includes funded — a funded deal was committed). */
  committed: number
  /** Best case if every indication converts (includes committed). */
  potential: number
  /** Raw column sums, for stat bands that report the triple side by side. */
  indicated_raw: number
  committed_raw: number
  funded_raw: number
}

/**
 * Collapse a raise's investments into cumulative money levels
 * (funded ≤ committed ≤ potential). Per deal, the triple is lifecycle stages
 * of the same dollars, but entry style varies (some zero out indicated once
 * committed) — max() per deal keeps the levels honest either way.
 */
export function raiseLevels(investments: MoneyTriple[]): RaiseLevels {
  let funded = 0
  let committed = 0
  let potential = 0
  let indicated_raw = 0
  let committed_raw = 0
  let funded_raw = 0
  for (const i of investments) {
    const wired = i.amount_funded ?? 0
    const signed = Math.max(i.amount_committed ?? 0, wired)
    funded += wired
    committed += signed
    potential += Math.max(i.amount_indicated ?? 0, signed)
    indicated_raw += i.amount_indicated ?? 0
    committed_raw += i.amount_committed ?? 0
    funded_raw += i.amount_funded ?? 0
  }
  return { funded, committed, potential, indicated_raw, committed_raw, funded_raw }
}

export interface TrancheFill extends RaiseTranche {
  /** Dollars of this tranche covered by wired money. */
  funded: number
  /** Dollars covered by signed commitments (includes the funded portion). */
  committed: number
  /** Dollars covered if every indication converts (includes committed). */
  potential: number
}

/**
 * Sequential waterfall fill: tranche 1 fills first. Each fill figure is the
 * slice of the cumulative level that lands inside the tranche's window.
 */
export function fillTranches(tranches: RaiseTranche[], levels: RaiseLevels): TrancheFill[] {
  let start = 0
  return tranches.map((t) => {
    const slice = (level: number) => Math.min(Math.max(level - start, 0), t.amount)
    const fill: TrancheFill = {
      ...t,
      funded: slice(levels.funded),
      committed: slice(levels.committed),
      potential: slice(levels.potential),
    }
    start += t.amount
    return fill
  })
}

// ─── Validation (shared by the raise API routes) ─────────────────────────────

export type RaiseBody = Record<string, unknown>
export type RaiseFields = TablesInsert<'raises'>

export function parseRaiseFields(
  body: RaiseBody
): { ok: true; fields: RaiseFields } | { ok: false; error: string } {
  const str = (key: string): string | null => {
    const v = body[key]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }

  const name = str('name')
  if (!name) return { ok: false, error: 'Raise name is required.' }

  const target_kind = str('target_kind') ?? 'company'
  if (target_kind !== 'company' && target_kind !== 'project') {
    return { ok: false, error: 'Target must be either the company or a project.' }
  }
  const project_id = str('project_id')
  if (target_kind === 'project' && !project_id) {
    return { ok: false, error: 'Pick the project this raise funds.' }
  }

  let target_amount: number | null = null
  if (body.target_amount != null && body.target_amount !== '') {
    const parsed =
      typeof body.target_amount === 'number' ? body.target_amount : parseFloat(String(body.target_amount))
    if (isNaN(parsed) || parsed <= 0) return { ok: false, error: 'Target amount must be a positive number.' }
    target_amount = parsed
  }

  const rawStatus = str('status') ?? 'open'
  const status = (RAISE_STATUSES as string[]).includes(rawStatus) ? rawStatus : 'open'

  if (body.tranches != null && !Array.isArray(body.tranches)) {
    return { ok: false, error: 'Tranches must be a list.' }
  }
  const tranches = parseTranches(body.tranches ?? [])

  return {
    ok: true,
    fields: {
      name,
      target_kind,
      project_id: target_kind === 'project' ? project_id : null,
      target_amount,
      status,
      tranches: tranches as unknown as RaiseFields['tranches'],
      open_date: str('open_date'),
      target_close_date: str('target_close_date'),
      notes: str('notes'),
    },
  }
}
