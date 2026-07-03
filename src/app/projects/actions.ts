'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canAccessProject } from '@/lib/auth/viewer'

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

  // Win probability: integer 0-100 or null
  const rawPwin = (formData.get('win_probability') as string | null) ?? ''
  let win_probability: number | null = null
  if (rawPwin !== '') {
    const parsed = Math.round(parseFloat(rawPwin))
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      return { ok: false, error: 'Win probability must be between 0 and 100.' }
    }
    win_probability = parsed
  }

  // Bid decision: go/no-go gate
  const rawDecision = str('bid_decision')
  const bid_decision =
    rawDecision === 'pursue' || rawDecision === 'no_bid' ? rawDecision : 'undecided'

  // Competitors: newline- or comma-separated list -> string[]
  const rawCompetitors = str('competitors')
  const competitors = rawCompetitors
    ? rawCompetitors
        .split(/[\n,]+/)
        .map((c) => c.trim())
        .filter(Boolean)
    : []

  // Parse applicable standards JSON
  const standardsRaw = str('applicable_standards')
  let applicable_standards: string[] | null = null
  if (standardsRaw) {
    try {
      applicable_standards = JSON.parse(standardsRaw)
    } catch {
      applicable_standards = ['usace_qm', 'dod_385']
    }
  }

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
      bid_due_date: str('bid_due_date'),
      award_date: str('award_date'),
      ntp_date: str('ntp_date'),
      substantial_completion_date: str('substantial_completion_date'),
      parent_project_id: str('parent_project_id'),
      win_probability,
      bid_decision,
      capture_lead: str('capture_lead'),
      incumbent: str('incumbent'),
      competitors,
      win_strategy: str('win_strategy'),
      ...(applicable_standards ? { applicable_standards } : {}),
    } as ParsedFields,
  }
}

export async function createProject(
  _prev: ProjectFormState,
  formData: FormData
): Promise<ProjectFormState> {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return { error: 'Only admins can create projects.' }

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
  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !(await canAccessProject(viewer, id)))) {
    return { error: 'You do not have access to edit this project.' }
  }

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
