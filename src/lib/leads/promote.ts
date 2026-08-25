/**
 * Turning a lead into a record.
 *
 * A lead is deliberately NOT a project: 10 of 15 projects already sit in
 * pursuit/capture/bid, and letting every ITB become one is what put $50B of
 * notional pipeline into the dashboard. Promotion is the gate — it happens when
 * a human decides to spend capture effort, which is exactly what `pursuit` means.
 *
 * Deliberately does NOT route through email_intake_sessions. The lead already
 * carries a full extraction and a fit assessment, and that review queue is 100+
 * deep; a second review step would bury the decision the human just made.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'
import { canonicalLeadSource } from '@/lib/utils/steel'
import type { Database } from '@/types/database'
import { leadsDb, parseLeadAttachments, type LeadAttachment, type LeadRow } from './db'
import { LEAD_FOLDER } from './score-phase'

export type PromoteTarget = 'project' | 'opportunity' | 'steel'

export interface PromoteResult {
  target: PromoteTarget
  id: string
  documentsCopied: number
}

type Sector = Database['public']['Enums']['project_sector']

const SECTORS: Sector[] = [
  'government',
  'infrastructure',
  'real_estate',
  'prefab',
  'institutional',
  'technology',
  'health',
]

/**
 * The lead's sector is free text from the model, but projects.sector is a
 * Postgres enum and a bad value fails the whole insert. Anything unrecognized
 * falls back to the sector most inbound solicitations belong to.
 */
export function toSector(value: string | null): Sector {
  const v = (value ?? '').trim().toLowerCase()
  return SECTORS.includes(v as Sector) ? (v as Sector) : 'government'
}

/**
 * Copy the lead's staged files onto the created record.
 *
 * Copies rather than moves: the lead keeps its evidence, so a promotion that is
 * later undone doesn't strand the record without its RFP. Storage is cheap; a
 * missing bid package is not.
 *
 * Downloads each file once rather than using storage-side copy, because the AI
 * pass needs the bytes anyway — one round trip serves both.
 */
async function copyAttachments(
  attachments: LeadAttachment[],
  destPrefix: string,
  row: (path: string, a: LeadAttachment) => Record<string, unknown>,
  table: 'documents' | 'opportunity_documents',
  opts: { projectId?: string | null; index?: boolean } = {}
): Promise<number> {
  if (attachments.length === 0) return 0
  const supabase = createAdminClient()
  let copied = 0

  for (const a of attachments) {
    const dest = `${destPrefix}/${Date.now()}-${a.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { data: blob, error: dlErr } = await supabase.storage
      .from('documents')
      .download(a.storage_path)
    if (dlErr || !blob) {
      console.error(`[leads/promote] could not read ${a.name}:`, dlErr?.message)
      continue
    }
    const buffer = await blob.arrayBuffer()

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(dest, buffer, { contentType: a.mime_type ?? 'application/octet-stream' })
    if (upErr) {
      console.error(`[leads/promote] could not copy ${a.name}:`, upErr.message)
      continue
    }

    const { data, error } = await supabase
      .from(table)
      .insert(row(dest, a) as never)
      .select('id')
      .single()
    if (error) {
      console.error(`[leads/promote] could not register ${a.name}:`, error.message)
      continue
    }
    copied++

    // Index it so the RFP is searchable from Ber AI. runDocumentAiPass never
    // throws and settles embedding_status itself.
    if (opts.index) {
      await runDocumentAiPass({
        supabase,
        documentId: (data as { id: string }).id,
        projectId: opts.projectId ?? null,
        fileName: a.name,
        mimeType: a.mime_type,
        buffer,
      })
    }
  }

  return copied
}

/** A readable record of where this came from, saved onto the created record. */
export function originNote(lead: LeadRow): string {
  const bits = [
    `Inbound lead from ${lead.sender_company ?? lead.sender_email ?? 'an email enquiry'}`,
    lead.received_at ? `received ${lead.received_at.slice(0, 10)}` : null,
    lead.mailbox ? `via ${lead.mailbox}` : null,
  ].filter(Boolean)

  const lines = [`${bits.join(' ')}.`, '']
  if (lead.summary) lines.push(lead.summary, '')
  if (lead.key_facts.length) lines.push('Key facts:', ...lead.key_facts.map((f) => `- ${f}`), '')
  if (lead.requirements.length) {
    lines.push('Requirements:', ...lead.requirements.map((r) => `- ${r}`), '')
  }
  if (lead.fit_summary) {
    lines.push(
      `Fit assessment (${lead.fit_recommendation ?? 'unscored'}${
        lead.fit_score != null ? `, ${lead.fit_score}/100` : ''
      }): ${lead.fit_summary}`
    )
  }
  return lines.join('\n').trim()
}

export async function promoteLead(
  lead: LeadRow,
  target: PromoteTarget,
  opts: { captureLead?: string | null; salespersonId?: string | null } = {}
): Promise<PromoteResult> {
  const supabase = createAdminClient()
  const db = leadsDb()
  const attachments = parseLeadAttachments(lead.attachments)

  let id: string
  let documentsCopied = 0

  if (target === 'project') {
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: lead.title,
        sector: toSector(lead.sector),
        // The gate: promoting means we are going after it.
        stage: 'pursuit',
        status: 'active',
        description: originNote(lead),
        estimated_value: lead.estimated_value,
        location: lead.location,
        client_entity: lead.sender_company,
        solicitation_number: lead.solicitation_number,
        bid_due_date: lead.bid_due_date,
        capture_lead: opts.captureLead ?? null,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create project: ${error.message}`)
    id = data.id

    documentsCopied = await copyAttachments(
      attachments,
      `projects/${id}`,
      (path, a) => ({
        project_id: id,
        storage_path: path,
        file_name: a.name,
        file_size_bytes: a.size_bytes,
        mime_type: a.mime_type,
        doc_type: 'solicitation',
      }),
      'documents',
      { projectId: id, index: true }
    )
  } else if (target === 'opportunity') {
    const { data, error } = await supabase
      .from('opportunities')
      .insert({
        name: lead.title,
        opp_type: 'partnership',
        status: 'identified',
        description: originNote(lead),
        objective: lead.summary,
        counterparty: lead.sender_company,
        sector: lead.sector,
        location: lead.location,
        estimated_value: lead.estimated_value,
        source: 'Inbound email',
        identified_date: lead.received_at?.slice(0, 10) ?? null,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create opportunity: ${error.message}`)
    id = data.id

    documentsCopied = await copyAttachments(
      attachments,
      `opportunities/${id}`,
      (path, a) => ({
        opportunity_id: id,
        storage_path: path,
        file_name: a.name,
        file_size_bytes: a.size_bytes,
        mime_type: a.mime_type,
        doc_type: 'other',
      }),
      'opportunity_documents'
    )

    // Make the new opportunity retrievable from Ber AI. Non-fatal: a missing
    // snapshot is a search gap, not a broken promotion.
    try {
      await embedOpportunitySnapshot(id)
    } catch (err) {
      console.error(
        '[leads/promote] opportunity snapshot embed failed:',
        err instanceof Error ? err.message : String(err)
      )
    }
  } else {
    const leadSource = canonicalLeadSource('Inbound Email', await leadSourcesInUse(supabase))
    const { data, error } = await supabase
      .from('steel_deals')
      .insert({
        name: lead.title,
        customer: lead.sender_company ?? lead.sender_name,
        stage: 'quote',
        lead_source: leadSource,
        lead_source_detail: lead.sender_email,
        description: originNote(lead),
        value: lead.estimated_value,
        salesperson_id: opts.salespersonId ?? null,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create steel deal: ${error.message}`)
    id = data.id

    documentsCopied = await copyAttachments(
      attachments,
      `steel-deals/${id}`,
      (path, a) => ({
        steel_deal_id: id,
        storage_path: path,
        file_name: a.name,
        file_size_bytes: a.size_bytes,
        mime_type: a.mime_type,
        doc_type: 'solicitation',
        // Steel deal files are commercial paper, not knowledge — the steel
        // module deliberately keeps them out of the AI index.
        embedding_status: 'skipped',
      }),
      'documents'
    )
  }

  const { error: markErr } = await db
    .from('leads')
    .update({
      status: 'promoted',
      promoted_at: new Date().toISOString(),
      promoted_project_id: target === 'project' ? id : null,
      promoted_opportunity_id: target === 'opportunity' ? id : null,
      promoted_steel_deal_id: target === 'steel' ? id : null,
    })
    .eq('id', lead.id)
  if (markErr) {
    // The record exists; failing here would leave the lead looking un-promoted
    // and invite a duplicate. Surface it rather than throwing it away.
    console.error(`[leads/promote] record created but lead not marked:`, markErr.message)
  }

  return { target, id, documentsCopied }
}

/** Storage prefix a lead's staged files live under. */
export function leadStoragePrefix(leadId: string): string {
  return `${LEAD_FOLDER}/${leadId}`
}
