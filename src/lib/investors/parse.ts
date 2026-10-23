// Shared validation for investment (commitment) writes — used by both the
// create (POST /api/investments) and update (PATCH /api/investments/[id]) routes.
//
// ⚠ `investments` IS THE RAISE PIPELINE — who we are talking to, what stage,
// what they have indicated, the next step. It is not a cap table and never was.
//
// ⚠ THE `spv` TARGET IS GONE (2026-10-23, with the Vehicles module). A
// commitment now names the parent company or a PROJECT, which is the whole of
// the union below and of the database CHECK. `spv_id` and `spv_entity_id` are
// both dropped columns — do not reintroduce either without reintroducing the
// table they pointed at. An OPPORTUNITY still cannot carry a commitment:
// `investments` has no `opportunity_id`, and the vehicle was the only way
// through. If that matters, it is a real column on this table, not a pointer
// at something rebuilt more often than the commitment is (§12).

import type { TablesInsert } from '@/lib/supabase/types'
import { INVESTMENT_STAGES, INSTRUMENTS } from '@/lib/utils/investors'

export type InvestmentBody = Record<string, unknown>

export type InvestmentFields = Omit<TablesInsert<'investments'>, 'investor_id'>

/**
 * What an investment can be into. The database CHECK enforces the same two
 * shapes, so a body that disagrees with this gets a 400 here rather than a 500
 * from Postgres.
 */
export const INVESTMENT_TARGETS = ['company', 'project'] as const
export type InvestmentTarget = (typeof INVESTMENT_TARGETS)[number]

/** The target columns, which always travel together on a write. */
export const TARGET_COLUMNS = ['target_kind', 'project_id'] as const

export function parseInvestmentFields(
  body: InvestmentBody
): { ok: true; fields: InvestmentFields } | { ok: false; error: string } {
  const str = (key: string): string | null => {
    const v = body[key]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }
  const num = (key: string): number | null | 'invalid' => {
    const v = body[key]
    if (v == null || v === '') return null
    const parsed = typeof v === 'number' ? v : parseFloat(String(v))
    return isNaN(parsed) || parsed < 0 ? 'invalid' : parsed
  }
  const pct = (key: string): number | null | 'invalid' => {
    const parsed = num(key)
    if (parsed === 'invalid' || (typeof parsed === 'number' && parsed > 100)) return 'invalid'
    return parsed
  }

  const target_kind = (str('target_kind') ?? 'company') as InvestmentTarget
  if (!(INVESTMENT_TARGETS as readonly string[]).includes(target_kind)) {
    return {
      ok: false,
      error: 'Target must be the parent company or a project.',
    }
  }
  const project_id = str('project_id')
  if (target_kind === 'project' && !project_id) {
    return { ok: false, error: 'Pick the project this investment targets.' }
  }

  const rawStage = str('stage') ?? 'discussing'
  const stage = (INVESTMENT_STAGES as string[]).includes(rawStage) ? rawStage : 'discussing'
  const rawInstrument = str('instrument')
  const instrument =
    rawInstrument && (INSTRUMENTS as string[]).includes(rawInstrument) ? rawInstrument : null

  const amounts: Partial<InvestmentFields> = {}
  for (const key of ['amount_indicated', 'amount_committed', 'amount_funded'] as const) {
    const parsed = num(key)
    if (parsed === 'invalid') return { ok: false, error: 'Amounts must be positive numbers.' }
    amounts[key] = parsed
  }
  const pcts: Partial<InvestmentFields> = {}
  for (const key of ['equity_pct', 'profit_share_pct', 'preferred_return_pct'] as const) {
    const parsed = pct(key)
    if (parsed === 'invalid') return { ok: false, error: 'Percentages must be between 0 and 100.' }
    pcts[key] = parsed
  }

  return {
    ok: true,
    fields: {
      target_kind,
      // ⚠ THE TARGET COLUMN IS NULLED FOR THE ARM THAT DOES NOT USE IT rather
      // than passed through, or switching a row from a project back to the
      // parent company would leave the old `project_id` in place and fail the
      // constraint.
      project_id: target_kind === 'project' ? project_id : null,
      raise_id: str('raise_id'),
      stage,
      instrument,
      ...amounts,
      ...pcts,
      terms_notes: str('terms_notes'),
      first_discussed_date: str('first_discussed_date'),
      committed_date: str('committed_date'),
      funded_date: str('funded_date'),
      target_close_date: str('target_close_date'),
      next_step: str('next_step'),
    },
  }
}
