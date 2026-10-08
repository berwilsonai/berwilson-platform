// Shared validation for investment (commitment) writes — used by both the
// create (POST /api/investments) and update (PATCH /api/investments/[id]) routes.
//
// ⚠ AN INVESTMENT TARGETS A VEHICLE, AND `investments` IS THE PIPELINE — NOT
// THE CAP TABLE. Two quantities were living in one shape: `investments` carried
// equity/committed/funded, and so did `project_spv_participants`, with nothing
// naming which was the record. They are now named apart and never summed:
//
//   investments               THE RAISE PIPELINE — who we are talking to, what
//                             stage, what they have indicated, the next step.
//   project_spv_participants  THE CAP TABLE — who holds what in the vehicle.
//                             The ledger of record, and the only thing
//                             `resolveBwShare` reads for our share.
//
// `spv_entity_id` is gone (20261008000001). It pointed at `entities` — the
// legal company — rather than at the vehicle on this deal, so the same LLC
// reused across two deals made the pointer ambiguous by construction.

import type { TablesInsert } from '@/lib/supabase/types'
import { INVESTMENT_STAGES, INSTRUMENTS } from '@/lib/utils/investors'

export type InvestmentBody = Record<string, unknown>

export type InvestmentFields = Omit<TablesInsert<'investments'>, 'investor_id'>

/**
 * What an investment can be into.
 *
 * ⚠ `spv` SETS `spv_id` AND LEAVES `project_id` NULL. The deal is reached
 * THROUGH the vehicle, which is the only way an opportunity-owned vehicle can
 * carry a commitment at all — `investments` has no `opportunity_id`, and a
 * second copy of "which deal" is a second definition that can drift. The
 * database CHECK enforces the same three shapes, so a body that disagrees with
 * this gets a 400 here rather than a 500 from Postgres.
 */
export const INVESTMENT_TARGETS = ['company', 'project', 'spv'] as const
export type InvestmentTarget = (typeof INVESTMENT_TARGETS)[number]

/** The three target columns, which always travel together on a write. */
export const TARGET_COLUMNS = ['target_kind', 'project_id', 'spv_id'] as const

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
      error: 'Target must be the parent company, a project, or an SPV on a deal.',
    }
  }
  const project_id = str('project_id')
  const spv_id = str('spv_id')
  if (target_kind === 'project' && !project_id) {
    return { ok: false, error: 'Pick the project this investment targets.' }
  }
  if (target_kind === 'spv' && !spv_id) {
    return { ok: false, error: 'Pick the vehicle this investment goes into.' }
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
      // ⚠ EXACTLY ONE TARGET COLUMN IS SET, MATCHING THE DATABASE CHECK. Both
      // are nulled for the arms that do not use them rather than passed
      // through, or switching a row from a vehicle back to the parent company
      // would leave the old `spv_id` in place and fail the constraint.
      project_id: target_kind === 'project' ? project_id : null,
      spv_id: target_kind === 'spv' ? spv_id : null,
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
