'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import type { TablesInsert } from '@/lib/supabase/types'

export type OpportunityFormState = { error: string } | null

type ParsedFields = TablesInsert<'opportunities'>
type ParseResult = { ok: true; fields: ParsedFields } | { ok: false; error: string }

function parseFields(formData: FormData): ParseResult {
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  const opp_type = (formData.get('opp_type') as string | null) ?? ''

  if (!name) return { ok: false, error: 'Opportunity name is required.' }
  if (!opp_type) return { ok: false, error: 'Opportunity type is required.' }

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  // Estimated value: positive number or null
  const rawValue = (formData.get('estimated_value') as string | null) ?? ''
  let estimated_value: number | null = null
  if (rawValue !== '') {
    const parsed = parseFloat(rawValue)
    if (isNaN(parsed) || parsed < 0) {
      return { ok: false, error: 'Estimated value must be a positive number.' }
    }
    estimated_value = parsed
  }

  // Ownership stake: 0–100 or null
  const rawStake = (formData.get('ownership_stake') as string | null) ?? ''
  let ownership_stake: number | null = null
  if (rawStake !== '') {
    const parsed = parseFloat(rawStake)
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      return { ok: false, error: 'Ownership stake must be between 0 and 100.' }
    }
    ownership_stake = parsed
  }

  // Probability: integer 0–100 or null
  const rawProb = (formData.get('probability') as string | null) ?? ''
  let probability: number | null = null
  if (rawProb !== '') {
    const parsed = Math.round(parseFloat(rawProb))
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      return { ok: false, error: 'Probability must be between 0 and 100.' }
    }
    probability = parsed
  }

  return {
    ok: true,
    fields: {
      name,
      opp_type,
      status: str('status') ?? 'identified',
      priority: str('priority') ?? 'medium',
      description: str('description'),
      objective: str('objective'),
      thesis: str('thesis'),
      target_name: str('target_name'),
      counterparty: str('counterparty'),
      sector: str('sector'),
      location: str('location'),
      website: str('website'),
      source: str('source'),
      estimated_value,
      deal_structure: str('deal_structure'),
      ownership_stake,
      probability,
      lead: str('lead'),
      identified_date: str('identified_date'),
      target_close_date: str('target_close_date'),
      next_step: str('next_step'),
    },
  }
}

export async function createOpportunity(
  _prev: OpportunityFormState,
  formData: FormData
): Promise<OpportunityFormState> {
  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('opportunities')
    .insert(result.fields)
    .select('id')
    .single()

  if (error) return { error: `Failed to create opportunity: ${error.message}` }

  // Make the opportunity findable by semantic search (skips pre-migration)
  embedOpportunitySnapshot(data.id).catch(console.error)

  redirect(`/opportunities/${data.id}`)
}

export async function updateOpportunity(
  id: string,
  _prev: OpportunityFormState,
  formData: FormData
): Promise<OpportunityFormState> {
  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('opportunities')
    .update(result.fields)
    .eq('id', id)

  if (error) return { error: `Failed to update opportunity: ${error.message}` }

  // Refresh the searchable snapshot (skips pre-migration)
  embedOpportunitySnapshot(id).catch(console.error)

  redirect(`/opportunities/${id}`)
}
