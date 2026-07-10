// Shared validation for investment (commitment) writes — used by both the
// create (POST /api/investments) and update (PATCH /api/investments/[id]) routes.

import type { TablesInsert } from '@/lib/supabase/types'
import { INVESTMENT_STAGES, INSTRUMENTS } from '@/lib/utils/investors'

export type InvestmentBody = Record<string, unknown>

export type InvestmentFields = Omit<TablesInsert<'investments'>, 'investor_id'>

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

  const target_kind = str('target_kind') ?? 'company'
  if (target_kind !== 'company' && target_kind !== 'project') {
    return { ok: false, error: 'Target must be either the company or a project.' }
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
      project_id: target_kind === 'project' ? project_id : null,
      spv_entity_id: str('spv_entity_id'),
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
