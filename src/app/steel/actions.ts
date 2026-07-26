'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canWorkSteel } from '@/lib/auth/viewer'
import { STEEL_STAGES, canonicalLeadSource } from '@/lib/utils/steel'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'

export type SteelDealFormState = { error: string } | null

type ParseResult = { ok: true; fields: TablesInsert<'steel_deals'> } | { ok: false; error: string }

function parseFields(formData: FormData): ParseResult {
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

  const square_feet = num('square_feet', 'Square feet')
  if (square_feet && typeof square_feet === 'object') return { ok: false, ...square_feet }
  const price_per_sqft = num('price_per_sqft', 'Price per square foot')
  if (price_per_sqft && typeof price_per_sqft === 'object') return { ok: false, ...price_per_sqft }
  const value = num('value', 'Contract value')
  if (value && typeof value === 'object') return { ok: false, ...value }

  const rawStage = str('stage') ?? 'quote'

  return {
    ok: true,
    fields: {
      name,
      customer: str('customer'),
      building_type: str('building_type'),
      lead_source: str('lead_source') ?? 'Other',
      lead_source_detail: str('lead_source_detail'),
      salesperson_id: str('salesperson_id'),
      stage: (STEEL_STAGES as string[]).includes(rawStage) ? rawStage : 'quote',
      square_feet: square_feet as number | null,
      price_per_sqft: price_per_sqft as number | null,
      value: value as number | null,
      expected_delivery_date: str('expected_delivery_date'),
      next_step: str('next_step'),
      next_step_date: str('next_step_date'),
      description: str('description'),
    },
  }
}

export async function createSteelDeal(
  _prev: SteelDealFormState,
  formData: FormData
): Promise<SteelDealFormState> {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return { error: 'You do not have access to the steel CRM.' }

  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  result.fields.lead_source = canonicalLeadSource(result.fields.lead_source, await leadSourcesInUse(supabase))
  const { data, error } = await supabase
    .from('steel_deals')
    .insert(result.fields)
    .select('id')
    .single()

  if (error) return { error: `Failed to create deal: ${error.message}` }

  redirect(`/steel/${data.id}`)
}

export async function updateSteelDeal(
  id: string,
  _prev: SteelDealFormState,
  formData: FormData
): Promise<SteelDealFormState> {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return { error: 'You do not have access to the steel CRM.' }

  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  result.fields.lead_source = canonicalLeadSource(result.fields.lead_source, await leadSourcesInUse(supabase))
  const { error } = await supabase.from('steel_deals').update(result.fields).eq('id', id)

  if (error) return { error: `Failed to update deal: ${error.message}` }

  redirect(`/steel/${id}`)
}
