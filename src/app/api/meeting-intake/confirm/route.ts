import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { embedUpdate, embedOpportunityReport, embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import {
  createRecordFromFields,
  saveReportDocument,
  str,
  type ConfirmTarget,
  type RecordKind,
} from '@/lib/email-ingestion/confirm-helpers'
import type { TablesInsert } from '@/lib/supabase/types'

export const maxDuration = 300

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
  /** Resolved team-member id (preferred). */
  assignee_id: string | null
  /** AI's free-text guess — fallback when assignee_id is absent. */
  assignee: string | null
  due_date: string | null
  include: boolean
  /** Client ref of the target this task belongs to, or null for no record. */
  target_ref: string | null
}

interface TargetInput {
  /** Stable client ref used to tie tasks to their target. */
  ref: string
  kind: RecordKind
  /** Existing record id — omit/null to create a new record from `new_fields`. */
  id?: string | null
  new_fields?: Record<string, unknown> | null
}

interface MeetingMeta {
  title: string | null
  date: string | null
  summary: string | null
  minutes: string | null
  decisions: string[]
}

interface ConfirmBody {
  session_id: string
  meeting: MeetingMeta
  targets: TargetInput[]
  attendee_actions: PartyAction[]
  task_actions: TaskAction[]
}

/** Compose the feed body (minutes + decisions) added to each record's update/note. */
function feedBody(meeting: MeetingMeta): string {
  const parts: string[] = []
  if (str(meeting.summary)) parts.push(meeting.summary!.trim())
  if (str(meeting.minutes)) parts.push(meeting.minutes!.trim())
  if (meeting.decisions.length > 0) {
    parts.push(`Decisions:\n${meeting.decisions.map((d) => `- ${d}`).join('\n')}`)
  }
  return parts.join('\n\n').slice(0, 100_000)
}

/** Compose the standalone meeting-minutes markdown document. */
function meetingDoc(meeting: MeetingMeta, attendees: { name: string; role: string | null }[]): string {
  const title = str(meeting.title) || 'Meeting notes'
  const lines: string[] = [`# ${title}`]
  if (str(meeting.date)) lines.push(`\n_${meeting.date}_`)
  if (attendees.length > 0) {
    lines.push(`\n**Attendees:** ${attendees.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', ')}`)
  }
  if (str(meeting.summary)) lines.push(`\n## Summary\n\n${meeting.summary!.trim()}`)
  if (meeting.decisions.length > 0) {
    lines.push(`\n## Decisions\n\n${meeting.decisions.map((d) => `- ${d}`).join('\n')}`)
  }
  if (str(meeting.minutes)) lines.push(`\n## Minutes\n\n${meeting.minutes!.trim()}`)
  return lines.join('\n')
}

export async function POST(request: NextRequest) {
  const supabase = await actorAdminClient()

  let body: ConfirmBody
  try {
    body = (await request.json()) as ConfirmBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id } = body
  if (!session_id) return Response.json({ error: 'session_id is required' }, { status: 400 })

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', session_id)
    .eq('status', 'pending')
    .eq('intake_kind', 'meeting')
    .single()

  if (!session) {
    return Response.json({ error: 'Session not found or already confirmed' }, { status: 404 })
  }

  const meeting = body.meeting ?? { title: null, date: null, summary: null, minutes: null, decisions: [] }
  if (!Array.isArray(meeting.decisions)) meeting.decisions = []

  const createdRecordIds: {
    project_ids: string[]
    opportunity_ids: string[]
    party_ids: string[]
    task_ids: string[]
    document_ids: string[]
  } = { project_ids: [], opportunity_ids: [], party_ids: [], task_ids: [], document_ids: [] }

  // ── 1. Resolve targets → record ids (existing, or create new) ────────────────
  const resolved = new Map<string, ConfirmTarget>() // client ref → {kind, id}
  for (const t of body.targets ?? []) {
    if (!t || !t.ref || (t.kind !== 'project' && t.kind !== 'opportunity')) continue

    if (t.id) {
      resolved.set(t.ref, { kind: t.kind, id: t.id })
    } else if (t.new_fields) {
      const created = await createRecordFromFields(supabase, t.kind, t.new_fields, { source: 'Meeting intake' })
      if (created.id) {
        resolved.set(t.ref, { kind: t.kind, id: created.id })
      } else {
        console.error('Meeting target create failed:', created.error)
      }
    }
  }

  const targets = Array.from(resolved.values())
  for (const tgt of targets) {
    if (tgt.kind === 'project') createdRecordIds.project_ids.push(tgt.id)
    else createdRecordIds.opportunity_ids.push(tgt.id)
  }

  // ── 2. Attendees → parties (match/create), meeting-wide ──────────────────────
  const linkedPeople: { id: string; name: string; role: string | null }[] = []
  for (const p of body.attendee_actions ?? []) {
    if (p.action === 'skip') continue
    let partyId: string | null = null
    if (p.action === 'link' && p.existing_party_id) {
      partyId = p.existing_party_id
    } else if (p.action === 'create' && str(p.name)) {
      const partyRow: TablesInsert<'parties'> = {
        full_name: p.name.trim(),
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
  }

  // ── 3. Fan the meeting out onto each target record ───────────────────────────
  const body_feed = feedBody(meeting)
  const docContent = meetingDoc(meeting, linkedPeople)
  const docTitle = `Meeting notes — ${str(meeting.title) || session.label || 'meeting'}`
  const attendeeNote =
    linkedPeople.length > 0
      ? `Attendees from meeting${meeting.title ? ` "${meeting.title}"` : ''}:\n${linkedPeople
          .map((p) => `• ${p.name}${p.role ? ` — ${p.role}` : ''}`)
          .join('\n')}`
      : null

  for (const tgt of targets) {
    if (tgt.kind === 'project') {
      // Update feed + embedding
      if (body_feed) {
        const updateRow: TablesInsert<'updates'> = {
          project_id: tgt.id,
          source: 'manual_paste',
          raw_content: body_feed,
          summary: `Meeting — ${str(meeting.title) || 'notes'}`,
          review_state: 'approved',
        }
        const { data: update, error: updateErr } = await supabase
          .from('updates')
          .insert(updateRow)
          .select('id')
          .single()
        if (updateErr) console.error('Meeting update insert failed:', updateErr)
        else embedUpdate(update.id, tgt.id, body_feed).catch(console.error)
      }
      // Players
      for (const person of linkedPeople) {
        await supabase.from('project_players').insert({
          project_id: tgt.id,
          party_id: person.id,
          role: person.role ?? 'Contact',
        })
      }
    } else {
      // Opportunity: notes feed + embedding
      if (body_feed) {
        await supabase.from('opportunity_notes').insert({
          opportunity_id: tgt.id,
          body: `Meeting — ${str(meeting.title) || 'notes'}\n\n${body_feed}`,
          author: 'Meeting intake',
        })
        embedOpportunityReport(tgt.id, body_feed).catch(console.error)
        embedOpportunitySnapshot(tgt.id).catch(console.error)
      }
      if (attendeeNote) {
        await supabase.from('opportunity_notes').insert({
          opportunity_id: tgt.id,
          body: attendeeNote,
          author: 'Meeting intake',
        })
      }
    }

    // Meeting-minutes document on every target.
    const docId = await saveReportDocument(supabase, tgt, {
      title: docTitle,
      content: docContent,
      aiSummary: str(meeting.summary),
      fileSlug: 'meeting_notes',
    })
    if (docId) createdRecordIds.document_ids.push(docId)
  }

  // ── 4. Tasks (assignee by name; record from the task's target_ref) ───────────
  const includedTasks = (body.task_actions ?? []).filter((t) => t.include && str(t.title))
  if (includedTasks.length > 0) {
    const { data: members } = await supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
    const memberIds = new Set((members ?? []).map((m) => m.id))
    const memberByName = new Map((members ?? []).map((m) => [m.name.toLowerCase(), m.id]))

    for (const t of includedTasks) {
      const tgt = t.target_ref ? resolved.get(t.target_ref) : undefined
      // Prefer the confirmed team-member id; fall back to matching the AI's name.
      const assigneeId =
        t.assignee_id && memberIds.has(t.assignee_id)
          ? t.assignee_id
          : t.assignee
            ? memberByName.get(t.assignee.toLowerCase()) ?? null
            : null
      const row: TablesInsert<'tasks'> = {
        title: t.title.trim(),
        what: str(t.what),
        why: str(t.why),
        how: str(t.how),
        assignee_id: assigneeId,
        project_id: tgt?.kind === 'project' ? tgt.id : null,
        due_date: str(t.due_date),
        status: 'open',
      }
      if (tgt?.kind === 'opportunity') row.opportunity_id = tgt.id

      const { data, error } = await supabase.from('tasks').insert(row).select('id').single()
      if (error) {
        console.error('Create task failed:', error)
        continue
      }
      createdRecordIds.task_ids.push(data.id)
    }
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

  const singleTarget = targets.length === 1 ? targets[0] : null
  return Response.json({
    ok: true,
    records_updated: targets.length,
    tasks_created: createdRecordIds.task_ids.length,
    parties_created: createdRecordIds.party_ids.length,
    documents_created: createdRecordIds.document_ids.length,
    redirect: singleTarget
      ? singleTarget.kind === 'project'
        ? `/projects/${singleTarget.id}`
        : `/opportunities/${singleTarget.id}`
      : null,
  })
}
