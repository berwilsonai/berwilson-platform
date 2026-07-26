'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import {
  STEEL_STAGES,
  STEEL_SERVICE_TYPES,
  STEEL_SERVICE_ORDER,
  referralFeeType,
  canonicalLeadSource,
  isPerSqftCostService,
  type SteelServiceType,
} from '@/lib/utils/steel'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'

type Db = SupabaseClient<Database>

export type SteelDealFormState = { error: string } | null

interface ParsedService {
  service_type: SteelServiceType
  price: number | null
  cost: number | null // undefined-as-null meaning "not provided" is handled by canSeeFinancials
  cost_per_sqft: number | null // basis for materials/assembly; null for engineering
  commission_pct: number | null
}

type ParseResult =
  | { ok: true; fields: TablesInsert<'steel_deals'>; services: ParsedService[] }
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

  // Services (prices come from everyone; cost/commission only from financials
  // users — otherwise left null here and preserved from existing rows on save).
  // Materials & assembly cost is driven by a per-SF basis (cost = SF × basis);
  // engineering cost is a manual dollar figure.
  const services: ParsedService[] = STEEL_SERVICE_TYPES.map((type) => {
    let cost: number | null = null
    let cost_per_sqft: number | null = null
    if (canSeeFinancials) {
      if (isPerSqftCostService(type)) {
        cost_per_sqft = money(`svc_${type}_cost_per_sqft`)
        cost = cost_per_sqft != null ? Math.round(sqftNum * cost_per_sqft * 100) / 100 : null
      } else {
        cost = money(`svc_${type}_cost`)
      }
    }
    return {
      service_type: type,
      price: money(`svc_${type}_price`),
      cost,
      cost_per_sqft,
      commission_pct: canSeeFinancials ? money(`svc_${type}_commission_pct`) : null,
    }
  })

  // Contract value = sum of service prices (the deal's revenue).
  const value = services.reduce((a, s) => a + (s.price ?? 0), 0)

  const fields: TablesInsert<'steel_deals'> = {
    name,
    customer: str('customer'),
    building_type: str('building_type'),
    lead_source: str('lead_source') ?? 'Other',
    lead_source_detail: str('lead_source_detail'),
    lead_source_id: str('lead_source_id'),
    salesperson_id: str('salesperson_id'),
    stage: (STEEL_STAGES as string[]).includes(rawStage) ? rawStage : 'quote',
    square_feet: square_feet as number | null,
    price_per_sqft: price_per_sqft as number | null,
    value,
    expected_delivery_date: str('expected_delivery_date'),
    next_step: str('next_step'),
    next_step_date: str('next_step_date'),
    description: str('description'),
  }

  // Referral fee is confidential — only set it when a financials user submits.
  if (canSeeFinancials) {
    fields.referral_fee_type = referralFeeType(str('referral_fee_type'))
    fields.referral_fee_value = fields.referral_fee_type === 'none' ? null : money('referral_fee_value')
  }

  return { ok: true, fields, services }
}

/**
 * Reconcile the deal's three service rows. Prices come from the form; cost and
 * commission are taken from the form only when the editor can see financials —
 * otherwise the existing values are preserved (a sales user can't wipe them).
 * commission_paid / date are always preserved across a normal save.
 */
async function saveServices(
  supabase: Db,
  dealId: string,
  parsed: ParsedService[],
  canSeeFinancials: boolean
) {
  const { data: existing } = await supabase
    .from('steel_deal_services')
    .select('*')
    .eq('deal_id', dealId)
  const byType = new Map((existing ?? []).map((s) => [s.service_type, s]))

  const toUpsert: TablesInsert<'steel_deal_services'>[] = []
  const toDelete: string[] = []

  for (const p of parsed) {
    const ex = byType.get(p.service_type)
    const price = p.price
    const cost = canSeeFinancials ? p.cost : (ex?.cost ?? null)
    const cost_per_sqft = canSeeFinancials ? p.cost_per_sqft : (ex?.cost_per_sqft ?? null)
    const commission_pct = canSeeFinancials ? p.commission_pct : (ex?.commission_pct ?? null)
    const commission_paid = ex?.commission_paid ?? false
    const hasData =
      price != null || cost != null || cost_per_sqft != null || commission_pct != null || commission_paid

    if (!hasData) {
      if (ex) toDelete.push(ex.id)
      continue
    }

    toUpsert.push({
      deal_id: dealId,
      service_type: p.service_type,
      price,
      cost,
      cost_per_sqft,
      commission_pct,
      commission_paid,
      commission_paid_date: ex?.commission_paid_date ?? null,
      sort_order: STEEL_SERVICE_ORDER[p.service_type],
    })
  }

  if (toDelete.length > 0) {
    await supabase.from('steel_deal_services').delete().in('id', toDelete)
  }
  if (toUpsert.length > 0) {
    await supabase.from('steel_deal_services').upsert(toUpsert, { onConflict: 'deal_id,service_type' })
  }
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

  await saveServices(supabase, data.id, result.services, canSeeFinancials)

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

  await saveServices(supabase, id, result.services, canSeeFinancials)

  redirect(`/steel/${id}`)
}
