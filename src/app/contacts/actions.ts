'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export type ContactFormState = { error: string } | { success: true } | null

function str(formData: FormData, key: string): string | null {
  return (formData.get(key) as string | null)?.trim() || null
}

export async function createContact(
  _prev: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const full_name = str(formData, 'full_name') ?? ''
  if (!full_name) return { error: 'Full name is required.' }

  const is_organization = formData.get('is_organization') === 'true'
  const companyName = str(formData, 'company')
  const entityId = str(formData, 'entity_id') // set when user picks from autocomplete

  const fields = {
    full_name,
    company: companyName,
    title: str(formData, 'title'),
    email: str(formData, 'email'),
    phone: str(formData, 'phone'),
    relationship_notes: str(formData, 'relationship_notes'),
    is_organization,
    status: 'active', // manually-added contacts go straight into the CRM
  }

  const supabase = createAdminClient()
  // Cast to bypass generated types — status column added via migration
  const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient

  // 1. Create the contact
  const { data, error } = await db
    .from('parties')
    .insert(fields)
    .select('id')
    .single()

  if (error) return { error: error.message }

  // 2. Link to company entity (find-or-create)
  if (companyName && !is_organization) {
    let linkedEntityId = entityId

    if (!linkedEntityId) {
      // No entity selected from autocomplete — check for exact match or create new
      const { data: existing } = await supabase
        .from('entities')
        .select('id')
        .ilike('name', companyName)
        .limit(1)
        .single()

      if (existing) {
        linkedEntityId = existing.id
      } else {
        // Auto-create a new entity with sensible defaults
        const { data: newEntity } = await supabase
          .from('entities')
          .insert({ name: companyName, entity_type: 'other' as const })
          .select('id')
          .single()
        linkedEntityId = newEntity?.id ?? null
      }
    }

    if (linkedEntityId) {
      // party_entities not yet in generated types
      await db
        .from('party_entities' as string)
        .insert({ party_id: data.id, entity_id: linkedEntityId, role: 'employee', is_primary: true })
    }
  }

  redirect(`/contacts/${data.id}`)
}

export async function updateContactNotes(
  partyId: string,
  _prev: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const relationship_notes = str(formData, 'relationship_notes')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('parties')
    .update({ relationship_notes })
    .eq('id', partyId)

  if (error) return { error: error.message }

  revalidatePath(`/contacts/${partyId}`)
  return { success: true }
}
