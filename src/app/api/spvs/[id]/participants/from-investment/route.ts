/**
 * POST /api/spvs/[id]/participants/from-investment — put a committed investor
 * on the vehicle's cap table.
 *
 * ⚠ THIS IS THE SEAM BETWEEN TWO DELIBERATELY SEPARATE LEDGERS, AND IT ONLY
 * EVER RUNS ON A HUMAN'S CLICK. `investments` is the raise PIPELINE — a
 * relationship over time, with soft indications and a stage. The participant
 * ledger is the CAP TABLE — who holds what in the vehicle, and the only thing
 * `resolveBwShare` reads. Copying one into the other automatically would mean a
 * soft indication silently became an ownership claim, so the act is a button
 * and the figures travel only once someone says they are real.
 *
 * ⚠ IT FILLS, IT NEVER OVERWRITES (CLAUDE.md §12, 09-30). If the investor is
 * already on the cap table — which is the normal state once a raise has been
 * running — this reports that and changes NOTHING. Filling a blank and
 * overwriting a value are different acts, and a cap table is the last place to
 * conflate them: the ledger is what a lawyer papered, and the pipeline row is
 * what a salesperson typed.
 *
 * ⚠ AND IT DOES NOT TOUCH `equity_pct`. A commitment in dollars is not an
 * ownership percentage — the conversion depends on the vehicle's total raise
 * and its waterfall, neither of which an investment row knows. Guessing it
 * would put a fabricated split into the one table our own share is read from.
 * The row lands with equity undetermined, which `splitWarnings` then says out
 * loud.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireSpvAccess } from '@/lib/spvs/access'
import { explainSpvError } from '@/lib/spvs/collections'
import { num, spvDbAs, type SpvParticipantRow } from '@/lib/spvs/db'
import type { SpvClass } from '@/lib/spvs/types'
import {
  INVESTMENT_STAGE_LABELS,
  investmentStage,
  type Instrument,
  type InvestmentStage,
} from '@/lib/utils/investors'

type Params = { params: Promise<{ id: string }> }

interface InvestmentRow {
  id: string
  spv_id: string | null
  investor_id: string
  stage: string
  amount_committed: string | number | null
  amount_funded: string | number | null
  preferred_return_pct: string | number | null
  profit_share_pct: string | number | null
  instrument: string | null
}

/**
 * Which raise stages are real enough to paper.
 *
 * A soft indication is not a holding. The cap table is the record of what was
 * agreed, so only a signed commitment, active papering or wired money crosses
 * over — and the refusal names the stage it saw, because "it didn't work" is
 * not actionable.
 *
 * ⚠ TYPED AGAINST `InvestmentStage`, NOT A LIST OF STRING LITERALS. A set
 * written from memory held `'closed'`, which is not a member of this vocabulary
 * at all — so it would have matched nothing while reading as if it covered the
 * end of the pipeline, and `'docs'` (papering under way) would have been
 * refused. A category the code was never told about simply never fires (§12).
 */
const LEDGER_STAGES: ReadonlySet<InvestmentStage> = new Set<InvestmentStage>([
  'committed',
  'docs',
  'funded',
])

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireSpvAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const investmentId = typeof body.investment_id === 'string' ? body.investment_id : null
  if (!investmentId) {
    return Response.json({ error: 'investment_id is required' }, { status: 400 })
  }

  const db = spvDbAs(actorFrom(access.viewer))

  // ⚠ THE VEHICLE COMES FROM THE PATH AND IS CHECKED AGAINST THE INVESTMENT'S
  // OWN `spv_id`, NOT TAKEN FROM THE BODY. Otherwise a body naming a vehicle
  // the caller may see and an investment on a deal they may not would copy a
  // commitment across deals (same reasoning as `assertSpvBelongs`).
  const { data: invRow, error: invError } = await db
    .from('investments')
    .select(
      'id,spv_id,investor_id,stage,amount_committed,amount_funded,preferred_return_pct,profit_share_pct,instrument'
    )
    .eq('id', investmentId)
    .maybeSingle()
  if (invError) {
    return Response.json({ error: `Could not read the commitment: ${invError.message}` }, { status: 400 })
  }
  if (!invRow) return Response.json({ error: 'That commitment no longer exists.' }, { status: 404 })

  const investment = invRow as InvestmentRow
  if (investment.spv_id !== id) {
    return Response.json(
      {
        error:
          'That commitment is not into this vehicle. Point the commitment at this vehicle first, so the pipeline and the cap table agree about which structure the money is going into.',
      },
      { status: 400 }
    )
  }
  const stage = investmentStage(investment.stage)
  if (!LEDGER_STAGES.has(stage)) {
    return Response.json(
      {
        error: `This commitment is at "${INVESTMENT_STAGE_LABELS[stage]}". The cap table records what has been agreed, so it takes a commitment at Committed, In Docs or Funded — a soft indication is a conversation, not a holding.`,
      },
      { status: 400 }
    )
  }

  const { data: investorRow, error: investorError } = await db
    .from('investors')
    .select('id,name')
    .eq('id', investment.investor_id)
    .maybeSingle()
  if (investorError) {
    return Response.json({ error: `Could not read the investor: ${investorError.message}` }, { status: 400 })
  }
  if (!investorRow) {
    return Response.json({ error: 'That investor no longer exists.' }, { status: 404 })
  }
  const investor = investorRow as { id: string; name: string }

  // Already on the ledger → report it and change nothing.
  const { data: existing, error: existingError } = await db
    .from('project_spv_participants')
    .select('*')
    .eq('spv_id', id)
    .eq('investor_id', investment.investor_id)
    .maybeSingle()
  if (existingError) {
    return Response.json({ error: `Could not read the cap table: ${existingError.message}` }, { status: 400 })
  }
  if (existing) {
    const row = existing as SpvParticipantRow
    return Response.json({
      row,
      created: false,
      message: `${investor.name} is already on this vehicle's cap table. Nothing was changed — edit the ledger row directly if the figures have moved, so a pipeline entry can never quietly rewrite what was papered.`,
    })
  }

  const { data, error } = await db
    .from('project_spv_participants')
    .insert({
      spv_id: id,
      holder_name: investor.name,
      investor_id: investment.investor_id,
      // ⚠ NEVER TRUE HERE. `is_ber_wilson` is the flag our own share is read
      // from, and an investor is by definition not us. One per vehicle is
      // enforced by `uniq_spv_participants_bw`.
      is_ber_wilson: false,
      role: 'capital_partner',
      class: instrumentClass(investment.instrument),
      // equity_pct is deliberately absent — see the header. Dollars are not a
      // percentage, and this table is where our own share comes from.
      capital_committed: num(investment.amount_committed),
      capital_funded: num(investment.amount_funded),
      preferred_return_pct: num(investment.preferred_return_pct),
      profit_share_pct: num(investment.profit_share_pct),
      // The raise said it is signed; that is `loi_term_sheet` on the
      // provenance scale, not `contracted`. Only the vehicle's own documents
      // can move it up, and overstating it would launder the whole vehicle's
      // status through `effectiveSpvStatus`.
      status: stage === 'funded' ? 'contracted' : 'loi_term_sheet',
      note: `From the capital raise pipeline (${INVESTMENT_STAGE_LABELS[stage]}). Equity split not set — a dollar commitment is not an ownership percentage.`,
      sort_order: 0,
    })
    .select('*')
    .single()

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }

  return Response.json({
    row: data,
    created: true,
    message: `${investor.name} added to the cap table. Their equity split is undetermined — a dollar commitment is not a percentage, so set it once the vehicle's own documents say what it is.`,
  })
}

/**
 * The instrument a raise recorded, in the cap table's vocabulary.
 *
 * ⚠ AN EXHAUSTIVE `Record`, NOT A `switch` WITH A DEFAULT. Two vocabularies
 * have to be kept in step here, and a `default` arm means adding an instrument
 * to `INSTRUMENTS` silently maps it to whatever the fallback happens to be,
 * forever, with nothing reporting it. Typed this way, `tsc` names this function
 * the moment either list grows.
 *
 * An unmapped instrument becomes `membership_units` only where that is the
 * truth: these vehicles are Utah LLCs and units are what a holder gets. Debt
 * and the share-based instruments are NOT equity classes, so they stay `other`
 * rather than being dressed as ownership in the one table our share is read
 * from.
 */
const INSTRUMENT_CLASS: Record<Instrument, SpvClass> = {
  common_equity: 'common',
  preferred_equity: 'preferred',
  convertible_note: 'convertible_note',
  debt: 'other',
  mezzanine: 'other',
  profit_share: 'profits_interest',
  revenue_share: 'other',
  other: 'other',
}

function instrumentClass(instrument: string | null): SpvClass {
  if (!instrument) return 'membership_units'
  return INSTRUMENT_CLASS[instrument as Instrument] ?? 'other'
}
