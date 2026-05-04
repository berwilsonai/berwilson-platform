'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export type ProjectFormState = { error: string } | null

type ParsedFields = TablesInsert<'projects'>
type ParseResult = { ok: true; fields: ParsedFields } | { ok: false; error: string }

function parseFields(formData: FormData): ParseResult {
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  const sector = (formData.get('sector') as string | null) ?? ''

  if (!name) return { ok: false, error: 'Project name is required.' }
  if (!sector) return { ok: false, error: 'Sector is required.' }

  const rawValue = (formData.get('estimated_value') as string | null) ?? ''
  let estimated_value: number | null = null
  if (rawValue !== '') {
    const parsed = parseFloat(rawValue)
    if (isNaN(parsed) || parsed <= 0) {
      return { ok: false, error: 'Estimated value must be a positive number.' }
    }
    estimated_value = parsed
  }

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  return {
    ok: true,
    fields: {
      name,
      sector: sector as TablesInsert<'projects'>['sector'],
      status: (str('status') as TablesInsert<'projects'>['status']) ?? null,
      stage: (str('stage') as TablesInsert<'projects'>['stage']) ?? null,
      description: str('description'),
      estimated_value,
      contract_type: str('contract_type'),
      delivery_method: str('delivery_method'),
      location: str('location'),
      client_entity: str('client_entity'),
      solicitation_number: str('solicitation_number'),
      award_date: str('award_date'),
      ntp_date: str('ntp_date'),
      substantial_completion_date: str('substantial_completion_date'),
      parent_project_id: str('parent_project_id'),
    },
  }
}

export async function createProject(
  _prev: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('projects')
    .insert(result.fields)
    .select('id')
    .single()

  if (error) return { error: `Failed to create project: ${error.message}` }

  const redirectAfterCreate = (formData.get('redirect_after_create') as string | null) ?? ''
  redirect(redirectAfterCreate || `/projects/${data.id}`)
}

export async function updateProject(
  id: string,
  _prev: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  const result = parseFields(formData)
  if (!result.ok) return { error: result.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('projects')
    .update(result.fields)
    .eq('id', id)

  if (error) return { error: `Failed to update project: ${error.message}` }

  redirect(`/projects/${id}`)
}
