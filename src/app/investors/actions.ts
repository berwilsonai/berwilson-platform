'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer } from '@/lib/auth/viewer'
import { INSTRUMENTS, INVESTOR_TYPES, INVESTOR_STAGES, INTEREST_LEVELS } from '@/lib/utils/investors'
import { SECTORS } from '@/lib/utils/constants'

export type InvestorFormState = { error: string } | null

type ParsedFields = Omit<TablesInsert<'investors'>, 'party_id'> & { party_id?: string | null }
type ParseResult = { ok: true; fields: ParsedFields } | { ok: false; error: string }

function parseFields(formData: FormData): ParseResult {
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) return { ok: false, error: 'Investor name is required.' }

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  const num = (key: string, label: string): number | null | { error: string } => {
    const raw = (formData.get(key) as string | null) ?? ''
    if (raw === '') return null
    const parsed = parseFloat(raw)
    if (isNaN(parsed) || parsed < 0) return { error: `${label} must be a positive number.` }
    return parsed
  }

  const check_size_min = num('check_size_min', 'Minimum check size')
  if (check_size_min && typeof check_size_min === 'object') return { ok: false, ...check_size_min }
  const check_size_max = num('check_size_max', 'Maximum check size')
  if (check_size_max && typeof check_size_max === 'object') return { ok: false, ...check_size_max }
  if (
    typeof check_size_min === 'number' &&
    typeof check_size_max === 'number' &&
    check_size_min > check_size_max
  ) {
    return { ok: false, error: 'Minimum check size cannot exceed the maximum.' }
  }

  // Multi-selects, constrained to the known vocabularies
  const preferred_structures = formData
    .getAll('preferred_structures')
    .map((v) => String(v))
    .filter((v) => (INSTRUMENTS as string[]).includes(v))
  const sector_interests = formData
    .getAll('sector_interests')
    .map((v) => String(v))
    .filter((v) => (SECTORS as readonly string[]).includes(v))

  const rawType = str('investor_type') ?? 'individual'
  const rawStage = str('stage') ?? 'identified'
  const rawInterest = str('interest_level') ?? 'warm'

  return {
    ok: true,
    fields: {
      name,
      party_id: str('party_id'),
      investor_type: (INVESTOR_TYPES as string[]).includes(rawType) ? rawType : 'other',
      stage: (INVESTOR_STAGES as string[]).includes(rawStage) ? rawStage : 'identified',
      interest_level: (INTEREST_LEVELS as string[]).includes(rawInterest) ? rawInterest : 'warm',
      check_size_min: check_size_min as number | null,
      check_size_max: check_size_max as number | null,
      preferred_structures,
      sector_interests,
      source: str('source'),
      referred_by: str('referred_by'),
      relationship_owner_id: str('relationship_owner_id'),
      next_step: str('next_step'),
      next_step_date: str('next_step_date'),
      last_contact_date: str('last_contact_date'),
      notes: str('notes'),
    },
  }
}

/**
 * Resolve the directory link: an explicitly picked party wins; otherwise
 * find an existing party by exact name, otherwise create one so the investor
 * also shows up in Contacts (one identity, per CLAUDE.md §10).
 */
async function resolveParty(
  supabase: ReturnType<typeof createAdminClient>,
  name: string,
  pickedPartyId: string | null,
  investorType: string
): Promise<string | null> {
  if (pickedPartyId) return pickedPartyId

  const { data: existing } = await supabase
    .from('parties')
    .select('id')
    .ilike('full_name', name)
    .neq('status', 'archived')
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('parties')
    .insert({
      full_name: name,
      is_organization: investorType !== 'individual',
      relationship_notes: 'Added from the Investors pipeline.',
      tags: ['investor'],
    })
    .select('id')
    .single()
  if (error) {
    console.error('Failed to create directory entry for investor:', error.message)
    return null // non-fatal — the investor record stands alone
  }
  return created.id
}

export async function createInvestor(
  _prev: InvestorFormState,
  formData: FormData
): Promise<InvestorFormState> {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return { error: 'Only admins can create investors.' }

  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  const party_id = await resolveParty(
    supabase,
    result.fields.name,
    result.fields.party_id ?? null,
    result.fields.investor_type ?? 'individual'
  )

  const { data, error } = await supabase
    .from('investors')
    .insert({ ...result.fields, party_id })
    .select('id')
    .single()

  if (error) return { error: `Failed to create investor: ${error.message}` }

  // Make the investor findable by semantic search (skips pre-migration)
  embedInvestorSnapshot(data.id).catch(console.error)

  redirect(`/investors/${data.id}`)
}

export async function updateInvestor(
  id: string,
  _prev: InvestorFormState,
  formData: FormData
): Promise<InvestorFormState> {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return { error: 'Only admins can edit investors.' }

  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  // Editing never silently re-links the directory entry: keep an explicit pick,
  // otherwise leave the existing link untouched.
  const { party_id, ...rest } = result.fields
  const update = party_id ? { ...rest, party_id } : rest

  const supabase = createAdminClient()
  const { error } = await supabase.from('investors').update(update).eq('id', id)

  if (error) return { error: `Failed to update investor: ${error.message}` }

  // Refresh the searchable snapshot (skips pre-migration)
  embedInvestorSnapshot(id).catch(console.error)

  redirect(`/investors/${id}`)
}
