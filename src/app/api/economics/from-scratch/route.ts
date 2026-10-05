/**
 * POST /api/economics/from-scratch — put a scratch calculation onto a deal.
 *
 * ⚠ IT BUILDS THE SAME MODEL THE SCRATCHPAD WAS SHOWING, VIA `scratchModel`.
 * The alternative is a second translation from scratch inputs to lines, which
 * would drift from the one the browser computed and hand the reader a deal tab
 * that disagrees with the figure they just quoted.
 *
 * ⚠ AND IT ATTACHES RATHER THAN OVERWRITES. If the record already has a model,
 * the scratch line is ADDED to it. Filling a blank and overwriting a value are
 * different acts and only one is safe to automate (CLAUDE.md §12, 09-30): a
 * scratch calc must never silently replace a model someone has curated.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'
import { actorFrom, requireRecordAccess } from '@/lib/economics/access'
import { calcDbAs } from '@/lib/economics/db'
import { explainEconomicsError } from '@/lib/economics/collections'
import { createEconomics, lineInsert, loadEconomics } from '@/lib/economics/store'
import { scratchFromParams, scratchModel } from '@/lib/economics/scratch'
import type { RevenueLine } from '@/lib/economics'

/** Map one engine line onto the column set, so there is one translation. */
function columnsFor(line: RevenueLine): Record<string, unknown> {
  const common = {
    is_ber_wilson_revenue: line.isBerWilsonRevenue,
    status: line.status,
  }
  switch (line.type) {
    case 'energy_sale':
      return {
        ...common,
        mode: line.mode,
        mw: line.mw,
        load_factor: line.loadFactor,
        price: line.price,
        price_unit: line.priceUnit,
        term_years: line.termYears,
        escalator_pct: line.escalatorPct,
      }
    case 'capacity_charge':
      return {
        ...common,
        mw: line.mw,
        price: line.price,
        price_unit: line.priceUnit,
        term_years: line.termYears,
        escalator_pct: line.escalatorPct,
      }
    case 'dc_lease':
      return {
        ...common,
        it_mw: line.itMw,
        rate_per_kw_month: line.ratePerKwMonth,
        occupancy: line.occupancy,
        pue: line.pue,
        term_years: line.termYears,
        escalator_pct: line.escalatorPct,
      }
    case 'one_time_per_mw':
      return {
        ...common,
        mw: line.mw,
        price_per_mw: line.pricePerMw,
        counts_toward_project_value: line.countsTowardProjectValue,
      }
    case 'fee_margin':
      return { ...common, pct_of_line: line.pctOfLine, is_carve_out: line.isCarveOut }
    default:
      // The scratchpad only produces the five above. A new scratch shape that
      // forgets to come back here lands as a labelled line with no figures,
      // which is visible, rather than silently dropping its numbers.
      return common
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>

  const scope = scopeFromBody(body)
  if (!scope) {
    return Response.json(
      { error: 'Exactly one of project_id or opportunity_id is required' },
      { status: 400 }
    )
  }

  const access = await requireRecordAccess(scope.kind, scope.id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const params = typeof body.params === 'string' ? body.params : ''
  const scratch = scratchFromParams(new URLSearchParams(params))
  if (scratch.mw == null || scratch.price == null) {
    return Response.json(
      { error: 'A scratch calculation needs megawatts and a price before it can be saved' },
      { status: 400 }
    )
  }

  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'From the quick calc'

  const actor = actorFrom(access.viewer)
  const db = calcDbAs(actor)

  try {
    const existing = await loadEconomics(scope.kind, scope.id)
    const economicsId =
      existing?.economicsId ?? (await createEconomics(scope.kind, scope.id, actor))

    const model = scratchModel(scratch)
    // The deal-level discount rate only if the record has none: an existing
    // model's rate is a decision someone made and a scratch calc does not
    // overrule it.
    if (scratch.discountRatePct != null && existing?.input.discountRatePct == null) {
      const { error } = await db
        .from('deal_economics')
        .update({ discount_rate_pct: scratch.discountRatePct })
        .eq('id', economicsId)
      if (error) throw new Error(error.message)
    }

    const sortBase = (existing?.input.lines.length ?? 0) + 1
    const created: { id: string; label: string }[] = []
    // Inserted in order so the fee can reference the line it is taken on.
    for (const [index, line] of model.lines.entries()) {
      const isFee = line.type === 'fee_margin'
      const row = lineInsert(
        economicsId,
        line.type,
        isFee ? `${label} — Ber Wilson fee` : label,
        {
          ...columnsFor(line),
          referenced_line_id: isFee ? (created[0]?.id ?? null) : null,
          sort_order: sortBase + index,
        }
      )
      const { data, error } = await db
        .from('economics_lines')
        .insert(row)
        .select('id,label')
        .single()
      if (error) throw new Error(error.message)
      created.push(data as { id: string; label: string })
    }

    return Response.json({
      economics_id: economicsId,
      created_model: existing == null,
      lines_added: created.length,
      path: `${scope.kind === 'project' ? '/projects' : '/opportunities'}/${scope.id}/economics`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[economics] from-scratch failed:', message)
    return Response.json({ error: explainEconomicsError(message) }, { status: 500 })
  }
}
