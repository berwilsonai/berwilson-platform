import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { embedUpdate, embedOpportunityReport, embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import { storeExtractedText } from '@/lib/ai/document-text'
import {
  parseStagedAttachments,
  promoteStagedAttachment,
  processPromotedDocumentAi,
  removeStagedFiles,
  type PromotedDocument,
} from '@/lib/email-ingestion/attachments'
import type { TablesInsert } from '@/lib/supabase/types'
import { SECTORS } from '@/lib/utils/constants'
import { STAGES } from '@/lib/utils/constants'
import { oppType } from '@/lib/utils/opportunities'
import type { ProjectSector, ProjectStage } from '@/lib/supabase/types'

export const maxDuration = 300

type RecordKind = 'opportunity' | 'project'

interface PartyAction {
  name: string
  email: string | null
  company: string | null
  title: string | null
  role: string | null
  is_organization: boolean
  action: 'create' | 'link' | 'skip'
  existing_party_id?: string | null
}

interface TaskAction {
  title: string
  what: string | null
  why: string | null
  how: string | null
  assignee: string | null
  due_date: string | null
  include: boolean
}

interface ConfirmBody {
  session_id: string
  record_kind: RecordKind
  record_fields: Record<string, unknown>
  party_actions: PartyAction[]
  task_actions: TaskAction[]
  /** Storage paths of staged attachments to promote onto the created record. */
  attachment_paths?: string[]
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null
const num = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) ? v : v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null

export async function POST(request: NextRequest) {
  const supabase = await actorAdminClient()

  let body: ConfirmBody
  try {
    body = (await request.json()) as ConfirmBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, record_kind } = body
  if (!session_id) return Response.json({ error: 'session_id is required' }, { status: 400 })

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', session_id)
    .eq('status', 'pending')
    .single()

  if (!session) {
    return Response.json({ error: 'Session not found or already confirmed' }, { status: 404 })
  }

  const fields = body.record_fields ?? {}
  const createdRecordIds: {
    opportunity_id?: string
    project_id?: string
    party_ids: string[]
    task_ids: string[]
    document_ids: string[]
  } = { party_ids: [], task_ids: [], document_ids: [] }

  let opportunityId: string | null = null
  let projectId: string | null = null

  // ── 1. Create the primary record ────────────────────────────────────────────
  if (record_kind === 'project') {
    const name = str(fields.name)
    if (!name) return Response.json({ error: 'A project name is required.' }, { status: 400 })
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
    if (error) return Response.json({ error: `Failed to create project: ${error.message}` }, { status: 500 })
    projectId = data.id
    createdRecordIds.project_id = data.id
  } else {
    const name = str(fields.name)
    if (!name) return Response.json({ error: 'An opportunity name is required.' }, { status: 400 })

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
      source: 'Email ingestion',
    }
    const { data, error } = await supabase.from('opportunities').insert(row).select('id').single()
    if (error) return Response.json({ error: `Failed to create opportunity: ${error.message}` }, { status: 500 })
    opportunityId = data.id
    createdRecordIds.opportunity_id = data.id
  }

  // ── 2. People → parties (match/create) + project_players when project-kind ───
  const linkedPeople: { id: string; name: string; role: string | null }[] = []
  for (const p of body.party_actions ?? []) {
    if (p.action === 'skip') continue

    let partyId: string | null = null
    if (p.action === 'link' && p.existing_party_id) {
      partyId = p.existing_party_id
    } else if (p.action === 'create' && str(p.name)) {
      const partyRow: TablesInsert<'parties'> = {
        full_name: (p.name as string).trim(),
        email: str(p.email),
        company: str(p.company),
        title: str(p.title),
        is_organization: p.is_organization === true,
      }
      const { data, error } = await supabase.from('parties').insert(partyRow).select('id').single()
      if (error) {
        console.error('Create party failed:', error)
        continue
      }
      partyId = data.id
    }
    if (!partyId) continue

    createdRecordIds.party_ids.push(partyId)
    linkedPeople.push({ id: partyId, name: p.name, role: str(p.role) })

    if (projectId) {
      await supabase.from('project_players').insert({
        project_id: projectId,
        party_id: partyId,
        role: str(p.role) ?? 'Contact',
      })
    }
  }

  // Opportunities have no player link table — record the people in a note instead.
  if (opportunityId && linkedPeople.length > 0) {
    const bodyText = `Players from email ingestion:\n${linkedPeople
      .map((p) => `• ${p.name}${p.role ? ` — ${p.role}` : ''}`)
      .join('\n')}`
    await supabase.from('opportunity_notes').insert({
      opportunity_id: opportunityId,
      body: bodyText,
      author: 'Email ingestion',
    })
  }

  // ── 3. Tasks (assignee resolved by name against team_members) ────────────────
  const includedTasks = (body.task_actions ?? []).filter((t) => t.include && str(t.title))
  if (includedTasks.length > 0) {
    const { data: members } = await supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
    const memberByName = new Map(
      (members ?? []).map((m) => [m.name.toLowerCase(), m.id])
    )

    for (const t of includedTasks) {
      const assigneeId = t.assignee ? memberByName.get(t.assignee.toLowerCase()) ?? null : null
      const row: TablesInsert<'tasks'> = {
        title: (t.title as string).trim(),
        what: str(t.what),
        why: str(t.why),
        how: str(t.how),
        assignee_id: assigneeId,
        project_id: projectId,
        due_date: str(t.due_date),
        status: 'open',
      }
      if (opportunityId) row.opportunity_id = opportunityId

      const { data, error } = await supabase.from('tasks').insert(row).select('id').single()
      if (error) {
        console.error('Create task failed:', error)
        continue
      }
      createdRecordIds.task_ids.push(data.id)
    }
  }

  // ── 4. Provenance note on the record ─────────────────────────────────────────
  const provenance = `Created from Email Ingestion${session.label ? ` — "${session.label}"` : ''}.`
  if (opportunityId) {
    await supabase.from('opportunity_notes').insert({
      opportunity_id: opportunityId,
      body: provenance,
      author: 'Email ingestion',
    })
  }

  // ── 4b. Make the research report itself searchable from /intel ───────────────
  const reportText = typeof session.raw_text === 'string' ? session.raw_text.trim() : ''
  if (projectId && reportText) {
    // Project-kind: store the report as an approved update so it shows on the
    // project's Updates tab and flows through the standard embedding path.
    const reportContent = reportText.slice(0, 100_000)
    const updateRow: TablesInsert<'updates'> = {
      project_id: projectId,
      source: 'manual_paste',
      raw_content: reportContent,
      summary: `Email research report${session.label ? ` — ${session.label}` : ''}`,
      review_state: 'approved',
    }
    const { data: update, error: updateErr } = await supabase
      .from('updates')
      .insert(updateRow)
      .select('id')
      .single()
    if (updateErr) console.error('Report update insert failed:', updateErr)
    else embedUpdate(update.id, projectId, reportContent).catch(console.error)
  }
  if (opportunityId) {
    if (reportText) embedOpportunityReport(opportunityId, reportText).catch(console.error)
    embedOpportunitySnapshot(opportunityId).catch(console.error)
  }

  const target = projectId
    ? ({ kind: 'project', id: projectId } as const)
    : ({ kind: 'opportunity', id: opportunityId! } as const)

  // ── 4c. Research report → a real document on the record ─────────────────────
  // The full report (headed by the AI's narrative discussion summary) becomes a
  // named .md document. Deliberately NOT embedded — the update row (project) /
  // embedOpportunityReport (opportunity) above already index this content.
  if (reportText) {
    const extraction = session.extraction_result as { summary?: string; discussion_summary?: string } | null
    const discussion = typeof extraction?.discussion_summary === 'string' ? extraction.discussion_summary.trim() : ''
    const title = `Email research — ${session.label || 'report'}`
    const content =
      `# ${title}\n\n` +
      (discussion ? `## Discussion summary\n\n${discussion}\n\n---\n\n## Full research report\n\n` : '') +
      reportText

    const reportPath = `${target.kind === 'project' ? 'projects' : 'opportunities'}/${target.id}/${Date.now()}_email_research_report.md`
    const { error: reportUploadErr } = await supabase.storage
      .from('documents')
      .upload(reportPath, Buffer.from(content, 'utf-8'), { contentType: 'text/markdown', upsert: false })
    if (reportUploadErr) {
      console.error('Report document upload failed:', reportUploadErr.message)
    } else {
      const aiSummary = typeof extraction?.summary === 'string' ? extraction.summary : null
      const base = {
        storage_path: reportPath,
        file_name: `${title}.md`,
        file_size_bytes: Buffer.byteLength(content, 'utf-8'),
        mime_type: 'text/markdown',
        doc_type: 'other',
        ai_summary: aiSummary,
      }
      const { data: reportDoc, error: reportInsertErr } = projectId
        ? await supabase
            .from('documents')
            .insert({ ...base, project_id: projectId, source: 'document' })
            .select('id')
            .single()
        : await supabase
            .from('opportunity_documents')
            .insert({ ...base, opportunity_id: opportunityId! })
            .select('id')
            .single()
      if (reportInsertErr || !reportDoc) {
        console.error('Report document insert failed:', reportInsertErr?.message)
      } else {
        createdRecordIds.document_ids.push(reportDoc.id)
        // Store the text so the agent's get_document_content can quote it.
        storeExtractedText(
          supabase,
          projectId ? 'documents' : 'opportunity_documents',
          reportDoc.id,
          content
        ).catch(console.error)
      }
    }
  }

  // ── 4d. Promote the selected staged attachments into the record's documents ──
  const stagedAll = parseStagedAttachments(session.staged_attachments)
  const wanted = new Set((body.attachment_paths ?? []).filter((p) => typeof p === 'string'))
  const selected = stagedAll.filter((a) => wanted.has(a.storage_path))

  const promoted: PromotedDocument[] = []
  for (const [i, attachment] of selected.entries()) {
    const doc = await promoteStagedAttachment(supabase, attachment, target, i)
    if (doc) {
      promoted.push(doc)
      createdRecordIds.document_ids.push(doc.id)
    }
  }

  // Staged copies are no longer needed (selected files were copied out above).
  removeStagedFiles(supabase, stagedAll).catch(console.error)

  // Summary + transcription + embedding runs after the response, one document
  // at a time — the local model is slow and the user shouldn't wait on it.
  if (promoted.length > 0) {
    void (async () => {
      for (const doc of promoted) {
        await processPromotedDocumentAi(doc)
      }
    })()
  }

  // ── 5. Mark session confirmed ────────────────────────────────────────────────
  await supabase
    .from('email_intake_sessions')
    .update({
      status: 'confirmed',
      created_record_ids: createdRecordIds as unknown as never,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', session_id)

  return Response.json({
    ok: true,
    record_kind,
    opportunity_id: opportunityId,
    project_id: projectId,
    parties_created: createdRecordIds.party_ids.length,
    tasks_created: createdRecordIds.task_ids.length,
    documents_created: createdRecordIds.document_ids.length,
  })
}
