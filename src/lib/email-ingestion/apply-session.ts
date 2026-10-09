/**
 * Carry a reviewed intake session onto a record — either one this call creates
 * or one that already exists.
 *
 * ⚠ WHY THIS MOVED OUT OF THE CONFIRM ROUTE. Everything below used to live in
 * `api/email-ingestion/confirm` and ran only against a record it had just
 * inserted, so "attach this conversation to the Myton project" had nowhere to
 * go: the queue proposes one record per CLUSTER of correspondence, not one per
 * deal, so a long-running programme arrives as several proposals and confirming
 * them as they stand creates several copies of the same project. `merge` was
 * the escape hatch and it only ever LINKED the threads — the report, the
 * people, the tasks and the attachments the run had already assembled were
 * discarded, silently, which is why merging felt like throwing work away.
 *
 * One target parameter is the whole difference (§12: never fork a shared pass
 * per table — add a target). Both the review screen's "Add to existing" and the
 * Decide queue's "Merge → X" now run this same function, so a field added to
 * one path cannot go missing on the other.
 *
 * WHAT ATTACHING DOES NOT DO: it never overwrites a value a human already put
 * on the record, and never renames one. Blank columns are filled from the
 * correspondence and the filled names are reported back; everything else is
 * additive (players, tasks, documents, an update on the feed). Two sources for
 * one figure get two columns, not a winner — and on an existing record the
 * human's own figure is the one that stands.
 */

import { embedUpdate, embedOpportunityReport, embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import { linkClusterToRecord } from '@/lib/email-sweep/cluster-link'
import { publishRecordToDrive } from '@/lib/drive/publish'
import {
  parseStagedAttachments,
  promoteStagedAttachment,
  processPromotedDocumentAi,
  removeStagedFiles,
  type PromotedDocument,
} from '@/lib/email-ingestion/attachments'
import {
  createRecordFromFields,
  saveReportDocument,
  num,
  str,
  type RecordKind,
} from '@/lib/email-ingestion/confirm-helpers'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Tables, TablesInsert, JsonIn, TablesUpdate } from '@/lib/supabase/types'
import type { ConfirmBody } from '@/lib/email-ingestion/defaults'

type AdminClient = ReturnType<typeof createAdminClient>
type SessionRow = Tables<'email_intake_sessions'>

/** Where a reviewed session is being sent. */
export type ApplyDestination =
  | { mode: 'create'; kind: RecordKind }
  | { mode: 'existing'; kind: RecordKind; id: string }

export interface AppliedRecordIds {
  opportunity_id?: string
  project_id?: string
  /** True when this session was folded into a record that already existed. */
  attached_to_existing?: boolean
  /** The target's name at the moment of attaching — readable long after. */
  record_name?: string
  party_ids: string[]
  task_ids: string[]
  document_ids: string[]
  /** Columns that were blank on an existing record and filled from the mail. */
  fields_filled?: string[]
}

export interface ApplyResult {
  ok: true
  kind: RecordKind
  id: string
  name: string
  attached: boolean
  ids: AppliedRecordIds
  /** Players skipped because that person already held that role on the record. */
  players_already_linked: number
}

export interface ApplyFailure {
  ok: false
  status: number
  error: string
}

/**
 * Columns an attach may fill when they are blank.
 *
 * Deliberately NOT the full field list the create path writes. `name` is
 * excluded because attaching must never rename a record someone else is
 * working on; `projects.sector` and `opportunities.opp_type` are excluded
 * because they are NOT NULL on an existing row and therefore never blank —
 * "filling" them could only mean overwriting; and `stage`/`status` are
 * excluded because where a deal sits in the pipeline is a human's judgement,
 * not something an email reports.
 */
const FILLABLE: Record<RecordKind, string[]> = {
  project: [
    'description',
    'estimated_value',
    'contract_type',
    'delivery_method',
    'location',
    'client_entity',
  ],
  opportunity: [
    'sector',
    'location',
    'objective',
    'thesis',
    'target_name',
    'counterparty',
    'estimated_value',
    'next_step',
  ],
}

const NUMERIC_FIELDS = new Set(['estimated_value'])

/** Read an existing target and confirm it is really there before writing to it. */
export async function loadExistingTarget(
  supabase: AdminClient,
  kind: RecordKind,
  id: string
): Promise<{ id: string; name: string } | null> {
  const table = kind === 'project' ? 'projects' : 'opportunities'
  const { data } = await supabase.from(table).select('id, name').eq('id', id).single()
  return data ? { id: data.id, name: data.name } : null
}

/**
 * Fill only the columns that are currently empty, and say which ones moved.
 *
 * A blank here means NULL or a whitespace-only string. An existing value — even
 * one that contradicts the correspondence — is left exactly as it is: the whole
 * reason to attach rather than create is that a human already curated this
 * record.
 */
async function fillBlankFields(
  supabase: AdminClient,
  kind: RecordKind,
  id: string,
  fields: Record<string, unknown>
): Promise<string[]> {
  const columns = FILLABLE[kind]
  const table = kind === 'project' ? 'projects' : 'opportunities'

  const { data: current, error } = await supabase
    .from(table)
    .select(['id', ...columns].join(', '))
    .eq('id', id)
    .single()
  if (error || !current) {
    console.error('[email-intake] could not read target for field fill:', error?.message)
    return []
  }

  const row = current as unknown as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const col of columns) {
    const existing = row[col]
    const isBlank =
      existing === null ||
      existing === undefined ||
      (typeof existing === 'string' && existing.trim() === '')
    if (!isBlank) continue

    const incoming = NUMERIC_FIELDS.has(col) ? num(fields[col]) : str(fields[col])
    if (incoming === null) continue
    patch[col] = incoming
  }

  const filled = Object.keys(patch)
  if (filled.length === 0) return []

  // ⚠ BRANCHED RATHER THAN CAST THROUGH `as never`. The destination is chosen
  // at runtime and `patch` is assembled from the FILLABLE whitelist, so the
  // generated client cannot infer the row from `.from(table)`. Branching gives
  // each write its own table, so each one is checked against a real Update
  // shape — where the old single `as never` disabled checking on both.
  const { error: updateErr } =
    table === 'projects'
      ? await supabase
          .from('projects')
          .update(patch as unknown as TablesUpdate<'projects'>)
          .eq('id', id)
      : await supabase
          .from('opportunities')
          .update(patch as unknown as TablesUpdate<'opportunities'>)
          .eq('id', id)
  if (updateErr) {
    console.error('[email-intake] field fill failed:', updateErr.message)
    return []
  }
  return filled
}

/**
 * Apply a reviewed session to its destination.
 *
 * Non-fatal throughout after the record itself is settled: a failed player, a
 * failed task or a bad attachment is logged and skipped, because a confirm that
 * half-succeeded and then reported failure is the one outcome a reader cannot
 * act on. What the caller gets back is a count of what actually landed.
 */
export async function applySession(
  supabase: AdminClient,
  session: SessionRow,
  body: ConfirmBody,
  destination: ApplyDestination
): Promise<ApplyResult | ApplyFailure> {
  const kind = destination.kind
  const fields = body.record_fields ?? {}

  const ids: AppliedRecordIds = { party_ids: [], task_ids: [], document_ids: [] }

  // ── 1. Settle the record: create it, or adopt the one that already exists ───
  let recordId: string
  let recordName: string
  const attached = destination.mode === 'existing'

  if (destination.mode === 'existing') {
    const existing = await loadExistingTarget(supabase, kind, destination.id)
    if (!existing) {
      return { ok: false, status: 404, error: `That ${kind} no longer exists.` }
    }
    recordId = existing.id
    recordName = existing.name
    ids.attached_to_existing = true
    ids.fields_filled = await fillBlankFields(supabase, kind, recordId, fields)
  } else {
    const created = await createRecordFromFields(supabase, kind, fields, {
      source: 'Email ingestion',
    })
    if (created.error || !created.id) {
      const status = created.error?.includes('required') ? 400 : 500
      return { ok: false, status, error: created.error ?? 'Failed to create record.' }
    }
    recordId = created.id
    recordName = str(fields.name) ?? 'Untitled'
  }

  ids.record_name = recordName
  const opportunityId: string | null = kind === 'opportunity' ? recordId : null
  const projectId: string | null = kind === 'project' ? recordId : null
  if (projectId) ids.project_id = projectId
  if (opportunityId) ids.opportunity_id = opportunityId

  // ── 2. People → parties (match/create) + players on the record ─────────────
  //
  // On an EXISTING record the same person may already hold the same role, and
  // (project_id, party_id, role) is a unique constraint — so the insert would
  // fail rather than no-op. It cannot be an upsert either: the opportunity side
  // of that constraint is a PARTIAL unique index, which PostgREST has no way to
  // name as a conflict target (§12). So read the roll first and skip what is
  // already there, and count the skips rather than swallowing them.
  const existingRoles = new Set<string>()
  if (attached) {
    const col = projectId ? 'project_id' : 'opportunity_id'
    const { data: currentPlayers } = await supabase
      .from('project_players')
      .select('party_id, role')
      .eq(col, recordId)
    for (const p of currentPlayers ?? []) {
      existingRoles.add(`${p.party_id}:${(p.role ?? '').toLowerCase()}`)
    }
  }

  let playersAlreadyLinked = 0
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

    ids.party_ids.push(partyId)
    linkedPeople.push({ id: partyId, name: p.name, role: str(p.role) })

    const role = str(p.role) ?? 'Contact'
    if (existingRoles.has(`${partyId}:${role.toLowerCase()}`)) {
      playersAlreadyLinked++
      continue
    }

    // project_players hangs off EITHER a project or an opportunity since
    // 20260923000002 (nullable project_id + nullable opportunity_id,
    // exactly-one check).
    const { error: playerErr } = await supabase.from('project_players').insert({
      project_id: projectId,
      opportunity_id: opportunityId,
      party_id: partyId,
      role,
    })
    if (playerErr) console.error('Link player failed:', playerErr.message)
    else existingRoles.add(`${partyId}:${role.toLowerCase()}`)
  }

  // A readable roll-call on the opportunity's feed, alongside the real links.
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

  // ── 3. Tasks (assignee resolved by name against team_members) ──────────────
  const includedTasks = (body.task_actions ?? []).filter((t) => t.include && str(t.title))
  if (includedTasks.length > 0) {
    const { data: members } = await supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
    const memberByName = new Map((members ?? []).map((m) => [m.name.toLowerCase(), m.id]))

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
      ids.task_ids.push(data.id)
    }
  }

  // ── 4. Provenance note on the record ───────────────────────────────────────
  // The verb matters: a reader opening an established project wants to know
  // this arrived from the mail, not that the project was "created" today.
  const verb = attached ? 'Updated from' : 'Created from'
  const provenance = `${verb} Email Ingestion${session.label ? ` — "${session.label}"` : ''}.`
  if (opportunityId) {
    await supabase.from('opportunity_notes').insert({
      opportunity_id: opportunityId,
      body: provenance,
      author: 'Email ingestion',
    })
  }

  // ── 4b. Make the research report itself searchable from /intel ─────────────
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

  // ── 4c. Research report → a real document on the record ────────────────────
  // Deliberately NOT embedded — the update row (project) /
  // embedOpportunityReport (opportunity) above already index this content.
  if (reportText) {
    const extraction = session.extraction_result as {
      summary?: string
      discussion_summary?: string
    } | null
    const discussion =
      typeof extraction?.discussion_summary === 'string' ? extraction.discussion_summary.trim() : ''
    const title = `Email research — ${session.label || 'report'}`
    const content =
      `# ${title}\n\n` +
      (discussion ? `## Discussion summary\n\n${discussion}\n\n---\n\n## Full research report\n\n` : '') +
      reportText
    const aiSummary = typeof extraction?.summary === 'string' ? extraction.summary : null

    const docId = await saveReportDocument(supabase, target, {
      title,
      content,
      aiSummary,
      fileSlug: 'email_research_report',
    })
    if (docId) ids.document_ids.push(docId)
  }

  // ── 4d. Promote the selected staged attachments into the record's documents ─
  const stagedAll = parseStagedAttachments(session.staged_attachments)
  const wanted = new Set((body.attachment_paths ?? []).filter((p) => typeof p === 'string'))
  const selected = stagedAll.filter((a) => wanted.has(a.storage_path))

  const promoted: PromotedDocument[] = []
  for (const [i, attachment] of selected.entries()) {
    const doc = await promoteStagedAttachment(supabase, attachment, target, i)
    if (doc) {
      promoted.push(doc)
      ids.document_ids.push(doc.id)
    }
  }

  // Staged copies are no longer needed (selected files were copied out above).
  removeStagedFiles(supabase, stagedAll).catch(console.error)

  // Summary + transcription + embedding runs after the response, one document
  // at a time — the local model is slow and the user shouldn't wait on it.
  //
  // Drive publishing goes FIRST and does not wait on that pass: most of the
  // team cannot reach this tailnet-only platform, so these documents are only
  // useful to them once they are in Drive, and Drive carries the file, not the
  // AI summary.
  void (async () => {
    try {
      const published = await publishRecordToDrive(target.kind, target.id)
      if (published.failed > 0) {
        console.error('[email-intake] Drive publish partial:', published.errors)
      }
    } catch (err) {
      console.error(
        '[email-intake] Drive publish failed:',
        err instanceof Error ? err.message : err
      )
    }
    for (const doc of promoted) {
      await processPromotedDocumentAi(doc)
    }
  })()

  // ── 5. Mark session confirmed ──────────────────────────────────────────────
  await supabase
    .from('email_intake_sessions')
    .update({
      status: 'confirmed',
      created_record_ids: ids as unknown as JsonIn,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  // ── 6. The conversation keeps pointing at what it became ───────────────────
  // Attaching seeds the same 'linked' certainty a create does, which is the
  // whole point: the next reply on these threads posts to THIS record instead
  // of staging a second proposal for the same deal.
  await linkClusterToRecord(session.id, projectId, opportunityId)

  return {
    ok: true,
    kind,
    id: recordId,
    name: recordName,
    attached,
    ids,
    players_already_linked: playersAlreadyLinked,
  }
}
