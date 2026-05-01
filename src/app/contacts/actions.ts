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

  const fields: TablesInsert<'parties'> = {
    full_name,
    company: str(formData, 'company'),
    title: str(formData, 'title'),
    email: str(formData, 'email'),
    phone: str(formData, 'phone'),
    relationship_notes: str(formData, 'relationship_notes'),
    is_organization,
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('parties')
    .insert(fields)
    .select('id')
    .single()

  if (error) return { error: error.message }

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
