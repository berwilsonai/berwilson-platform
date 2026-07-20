/**
 * Shared confirm-time helpers for the intake flows (email ingestion + meeting
 * notes). Both create projects/opportunities from reviewed fields and save a
 * markdown report/minutes document onto the created/target record.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { storeExtractedText } from '@/lib/ai/document-text'
import type { TablesInsert } from '@/lib/supabase/types'
import type { ProjectSector, ProjectStage } from '@/lib/supabase/types'
import { SECTORS, STAGES } from '@/lib/utils/constants'
import { oppType } from '@/lib/utils/opportunities'

type AdminClient = ReturnType<typeof createAdminClient>

export type RecordKind = 'opportunity' | 'project'
export type ConfirmTarget = { kind: RecordKind; id: string }

export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null
export const num = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v)
    ? v
    : v != null && v !== '' && !isNaN(Number(v))
      ? Number(v)
      : null

export interface RecordCreateResult {
  id: string | null
  error: string | null
}

/**
 * Create a project or opportunity from reviewed record fields. Returns the new
 * id, or an error message the route can surface. Mirrors the insert shapes used
 * by the email-ingestion confirm route.
 */
export async function createRecordFromFields(
  supabase: AdminClient,
  kind: RecordKind,
  fields: Record<string, unknown>,
  opts: { source?: string } = {},
): Promise<RecordCreateResult> {
  if (kind === 'project') {
    const name = str(fields.name)
    if (!name) return { id: null, error: 'A project name is required.' }
    const sector = SECTORS.includes(fields.sector as ProjectSector)
      ? (fields.sector as ProjectSector)
      : ('real_estate' as ProjectSector)
    const stage = STAGES.includes(fields.stage as ProjectStage)
      ? (fields.stage as ProjectStage)
      : ('pursuit' as ProjectStage)

    const row: TablesInsert<'projects'> = {
      name,
      sector,
      stage,
      status: 'active',
      description: str(fields.description),
      estimated_value: num(fields.estimated_value),
      contract_type: str(fields.contract_type),
      delivery_method: str(fields.delivery_method),
      location: str(fields.location),
      client_entity: str(fields.client_entity),
    }
    const { data, error } = await supabase.from('projects').insert(row).select('id').single()
    if (error) return { id: null, error: `Failed to create project: ${error.message}` }
    return { id: data.id, error: null }
  }

  const name = str(fields.name)
  if (!name) return { id: null, error: 'An opportunity name is required.' }
  const row: TablesInsert<'opportunities'> = {
    name,
    opp_type: oppType(str(fields.opp_type)),
    status: 'identified',
    priority: 'medium',
    sector: str(fields.sector),
    location: str(fields.location),
    objective: str(fields.objective),
    thesis: str(fields.thesis),
    target_name: str(fields.target_name),
    counterparty: str(fields.counterparty),
    estimated_value: num(fields.estimated_value),
    next_step: str(fields.next_step),
    source: opts.source ?? null,
  }
  const { data, error } = await supabase.from('opportunities').insert(row).select('id').single()
  if (error) return { id: null, error: `Failed to create opportunity: ${error.message}` }
  return { id: data.id, error: null }
}

/**
 * Save a markdown document (report / meeting minutes) onto a target record and
 * store its extracted text so the agent can quote it. Deliberately NOT embedded
 * here — callers embed via the update row (project) / embedOpportunityReport
 * (opportunity). Returns the new document id, or null on failure (non-fatal).
 */
export async function saveReportDocument(
  supabase: AdminClient,
  target: ConfirmTarget,
  opts: { title: string; content: string; aiSummary: string | null; fileSlug?: string },
): Promise<string | null> {
  const slug = opts.fileSlug ?? 'report'
  const path = `${target.kind === 'project' ? 'projects' : 'opportunities'}/${target.id}/${Date.now()}_${slug}.md`

  const { error: uploadErr } = await supabase.storage
    .from('documents')
    .upload(path, Buffer.from(opts.content, 'utf-8'), { contentType: 'text/markdown', upsert: false })
  if (uploadErr) {
    console.error('Report document upload failed:', uploadErr.message)
    return null
  }

  const base = {
    storage_path: path,
    file_name: `${opts.title}.md`,
    file_size_bytes: Buffer.byteLength(opts.content, 'utf-8'),
    mime_type: 'text/markdown',
    doc_type: 'other',
    ai_summary: opts.aiSummary,
  }
  const { data: doc, error: insertErr } =
    target.kind === 'project'
      ? await supabase
          .from('documents')
          .insert({ ...base, project_id: target.id, source: 'document' })
          .select('id')
          .single()
      : await supabase
          .from('opportunity_documents')
          .insert({ ...base, opportunity_id: target.id })
          .select('id')
          .single()

  if (insertErr || !doc) {
    console.error('Report document insert failed:', insertErr?.message)
    return null
  }

  storeExtractedText(
    supabase,
    target.kind === 'project' ? 'documents' : 'opportunity_documents',
    doc.id,
    opts.content,
  ).catch(console.error)

  return doc.id
}
