'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import {
  STEEL_STAGES,
  referralFeeType,
  canonicalLeadSource,
  isPricingBelowFloor,
  steelCategory,
  isPerSqftCostService,
  DEFAULT_STEEL_COST_PER_SQFT,
  type SteelServiceType,
} from '@/lib/utils/steel'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'

type Db = SupabaseClient<Database>

export type SteelDealFormState = { error: string } | { ok: true; id: string } | null

interface ParsedLine {
  /** Existing row id (edit) or null for a new line. */
  id: string | null
  description: string | null
  category: SteelServiceType
  price: number | null
  // cost / commissionable / commission_pct are null when a non-financials user
  // submits (they never see those fields) → preserved from the existing row.
  cost: number | null
  commissionable: boolean | null
  commission_pct: number | null
}

type ParseResult =
  | { ok: true; fields: TablesInsert<'steel_deals'>; lines: ParsedLine[] }
  | { ok: false; error: string }

function parseFields(formData: FormData, canSeeFinancials: boolean): ParseResult {
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) return { ok: false, error: 'Deal name is required.' }

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  const num = (key: string, label: string): number | null | { error: string } => {
    const raw = ((formData.get(key) as string | null) ?? '').replace(/[$,\s]/g, '')
    if (raw === '') return null
    const parsed = parseFloat(raw)
    if (isNaN(parsed) || parsed < 0) return { error: `${label} must be a positive number.` }
    return parsed
  }

  // Lenient positive-number-or-null (service/referral money — no hard error).
  const money = (key: string): number | null => {
    const raw = ((formData.get(key) as string | null) ?? '').replace(/[$,\s]/g, '')
    if (raw === '') return null
    const parsed = parseFloat(raw)
    return isNaN(parsed) || parsed < 0 ? null : parsed
  }

  const square_feet = num('square_feet', 'Square feet')
  if (square_feet && typeof square_feet === 'object') return { ok: false, ...square_feet }
  const price_per_sqft = num('price_per_sqft', 'Price per square foot')
  if (price_per_sqft && typeof price_per_sqft === 'object') return { ok: false, ...price_per_sqft }
  const sqftNum = typeof square_feet === 'number' ? square_feet : 0

  const rawStage = str('stage') ?? 'quote'

  // Line items (prices come from everyone; cost/commissionable/commission only
  // from financials users — otherwise left null here and preserved from the
  // existing row on save). One row per submitted line, in form order.
  const lineCount = parseInt((formData.get('line_count') as string | null) ?? '0', 10) || 0
  const lines: ParsedLine[] = []
  for (let i = 0; i < lineCount; i++) {
    lines.push({
      id: str(`line_${i}_id`),
      description: str(`line_${i}_description`),
      category: steelCategory(str(`line_${i}_category`)),
      price: money(`line_${i}_price`),
      cost: canSeeFinancials ? money(`line_${i}_cost`) : null,
      commissionable: canSeeFinancials ? formData.has(`line_${i}_commissionable`) : null,
      commission_pct: canSeeFinancials ? money(`line_${i}_commission_pct`) : null,
    })
  }

  // Contract value = sum of line prices (the deal's revenue).
  const value = lines.reduce((a, l) => a + (l.price ?? 0), 0)

  // Flag deals priced below the steel $/SF floor — surfaced with a badge for
  // execs and warned on the form. Set for every author (sales enters prices).
  // Materials price = sum of the materials-category lines.
  const materialsPrice =
    lines.filter((l) => l.category === 'materials').reduce((a, l) => a + (l.price ?? 0), 0) || null
  const pricing_below_floor = isPricingBelowFloor(
    materialsPrice,
    sqftNum,
    typeof price_per_sqft === 'number' ? price_per_sqft : null
  )

  const fields: TablesInsert<'steel_deals'> = {
    name,
    customer: str('customer'),
    building_type: str('building_type'),
    lead_source: str('lead_source') ?? 'Other',
    lead_source_detail: str('lead_source_detail'),
    salesperson_id: str('salesperson_id'),
    // Marketing / referral source — any contact (party). Attribution, set by any
    // author (the referral FEE below is financials-only).
    referral_party_id: str('referral_party_id'),
    stage: (STEEL_STAGES as string[]).includes(rawStage) ? rawStage : 'quote',
    // ICP fields (buyer segment + buying trigger) — attribution for marketing
    // analytics, set by any author.
    icp_segment: str('icp_segment'),
    buying_trigger: str('buying_trigger'),
    square_feet: square_feet as number | null,
    price_per_sqft: price_per_sqft as number | null,
    value,
    pricing_below_floor,
    expected_delivery_date: str('expected_delivery_date'),
    next_step: str('next_step'),
    next_step_date: str('next_step_date'),
    description: str('description'),
  }

  // Rate overrides, install fee, and the referral fee are confidential money
  // controls — only set them when a financials user submits (otherwise the
  // existing values are preserved by not being written).
  if (canSeeFinancials) {
    fields.sales_rate_override = money('sales_rate_override')
    fields.install_fee = money('install_fee')
    fields.referral_fee_type = referralFeeType(str('referral_fee_type'))
    fields.referral_fee_value = fields.referral_fee_type === 'none' ? null : money('referral_fee_value')
  }

  return { ok: true, fields, lines }
}

/**
 * Reconcile the deal's line items against the submitted set. Prices/description/
 * category come from the form; cost / commissionable / commission % are taken
 * from the form only when the editor can see financials — otherwise preserved
 * from the existing row (a sales user can't wipe them). commission_paid / date
 * are always preserved. Lines removed from the form are deleted; empty lines
 * are dropped.
 *
 * `squareFeet` exists so a per-SF cost basis can be derived HERE rather than
 * only in the form. A sales rep never sees the cost fields, so nothing on the
 * client fills them in — without this the rep's new deal saved with no cost at
 * all, which reads as 100% margin and pays commission on the full sale price.
 */
async function saveServices(
  supabase: Db,
  dealId: string,
  lines: ParsedLine[],
  canSeeFinancials: boolean,
  squareFeet: number | null
) {
  const { data: existing } = await supabase
    .from('steel_deal_services')
    .select('*')
    .eq('deal_id', dealId)
  const byId = new Map((existing ?? []).map((s) => [s.id, s]))

  const withId: TablesInsert<'steel_deal_services'>[] = []
  const withoutId: TablesInsert<'steel_deal_services'>[] = []
  const keptIds = new Set<string>()

  lines.forEach((line, i) => {
    const ex = line.id ? byId.get(line.id) : undefined
    const price = line.price
    const submittedCost = canSeeFinancials ? line.cost : (ex?.cost ?? null)
    // Materials and assembly cost by the square foot. When no cost survived the
    // form (a sales-user submission, or a brand-new line), fall back to the
    // line's own basis or the company default so the deal always carries one.
    const cost =
      submittedCost ??
      (isPerSqftCostService(line.category) && squareFeet && squareFeet > 0
        ? Math.round(squareFeet * (ex?.cost_per_sqft ?? DEFAULT_STEEL_COST_PER_SQFT) * 100) / 100
        : null)
    const commissionable = canSeeFinancials ? (line.commissionable ?? true) : (ex?.commissionable ?? true)
    const commission_pct = canSeeFinancials ? line.commission_pct : (ex?.commission_pct ?? null)
    const commission_paid = ex?.commission_paid ?? false
    const description = line.description

    // Drop blank lines (nothing entered). An existing row that lands here is
    // simply not kept → deleted below.
    const hasData =
      price != null || cost != null || commission_pct != null || (description ?? '') !== '' || commission_paid
    if (!hasData) return

    const row: TablesInsert<'steel_deal_services'> = {
      deal_id: dealId,
      service_type: line.category,
      description,
      price,
      cost,
      cost_per_sqft:
        ex?.cost_per_sqft ??
        (isPerSqftCostService(line.category) && squareFeet && squareFeet > 0 && submittedCost == null
          ? DEFAULT_STEEL_COST_PER_SQFT
          : null),
      commissionable,
      commission_pct,
      commission_paid,
      commission_paid_date: ex?.commission_paid_date ?? null,
      sort_order: i,
    }

    if (ex) {
      row.id = ex.id
      keptIds.add(ex.id)
      withId.push(row)
    } else {
      withoutId.push(row)
    }
  })

  const toDelete = (existing ?? []).filter((s) => !keptIds.has(s.id)).map((s) => s.id)
  if (toDelete.length > 0) {
    await supabase.from('steel_deal_services').delete().in('id', toDelete)
  }
  // withId upserts on the PK (id) → updates; withoutId are fresh inserts.
  if (withId.length > 0) await supabase.from('steel_deal_services').upsert(withId)
  if (withoutId.length > 0) await supabase.from('steel_deal_services').insert(withoutId)
}

export async function createSteelDeal(
  _prev: SteelDealFormState,
  formData: FormData
): Promise<SteelDealFormState> {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return { error: 'You do not have access to the steel CRM.' }
  const canSeeFinancials = canSeeSteelFinancials(viewer)

  const result = parseFields(formData, canSeeFinancials)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  result.fields.lead_source = canonicalLeadSource(result.fields.lead_source, await leadSourcesInUse(supabase))
  const { data, error } = await supabase
    .from('steel_deals')
    .insert(result.fields)
    .select('id')
    .single()

  if (error) return { error: `Failed to create deal: ${error.message}` }

  await saveServices(supabase, data.id, result.lines, canSeeFinancials, result.fields.square_feet ?? null)

  // `_stay` = the drawer/inline editor wants a result back instead of a full
  // navigation, so it can close itself and refresh in place.
  if (formData.get('_stay')) return { ok: true, id: data.id }
  redirect(`/steel/${data.id}`)
}

export async function updateSteelDeal(
  id: string,
  _prev: SteelDealFormState,
  formData: FormData
): Promise<SteelDealFormState> {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return { error: 'You do not have access to the steel CRM.' }
  const canSeeFinancials = canSeeSteelFinancials(viewer)

  const result = parseFields(formData, canSeeFinancials)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  result.fields.lead_source = canonicalLeadSource(result.fields.lead_source, await leadSourcesInUse(supabase))
  const { error } = await supabase.from('steel_deals').update(result.fields).eq('id', id)

  if (error) return { error: `Failed to update deal: ${error.message}` }

  await saveServices(supabase, id, result.lines, canSeeFinancials, result.fields.square_feet ?? null)

  if (formData.get('_stay')) return { ok: true, id }
  redirect(`/steel/${id}`)
}
