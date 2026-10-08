import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { embedUpdate, embedOpportunityReport, embedOpportunitySnapshot, embedDocument } from '@/lib/ai/embeddings'
import { publishRecordToDrive } from '@/lib/drive/publish'
import {
  createRecordFromFields,
  saveReportDocument,
  num,
  str,
  type ConfirmTarget,
  type RecordKind,
  type TargetKind,
} from '@/lib/email-ingestion/confirm-helpers'
import { fileMeetingDocument, findFiledTranscript, type FileTarget } from '@/lib/meetings/file-notes'
import { refileDocument } from '@/lib/documents/refile'
import { attachMeetingToRecord, linkDocumentToMeeting } from '@/lib/meetings/record'
import { learnMeetingTitles } from '@/lib/email-sweep/identifiers'
import { meetingTargetFromTitle } from '@/lib/meetings/meet-import'
import { parseAttendees } from '@/lib/utils/meetings'
import { createLeadFromMeeting } from '@/lib/leads/from-meeting'
import type { TablesInsert } from '@/lib/supabase/types'

export const maxDuration = 300

interface PartyAction {
  /** Stable client ref so tasks can point at an attendee promoted to task owner. */
  ref: string
  name: string
  email: string | null
  company: string | null
  title: string | null
  role: string | null
  is_organization: boolean
  action: 'create' | 'link' | 'skip'
  existing_party_id?: string | null
  /** Internal person who can OWN tasks — find-or-create a linked team_member. */
  owner?: boolean
}

interface TaskAction {
  title: string
  what: string | null
  why: string | null
  how: string | null
  /**
   * Assignee reference: a real team-member id, or `owner:<attendeeRef>` for an
   * attendee promoted to owner in this pass. Falls back to `assignee` (name).
   */
  assignee_ref: string | null
  /** AI's free-text guess — fallback when assignee_ref doesn't resolve. */
  assignee: string | null
  due_date: string | null
  include: boolean
  /** Client ref of the target this task belongs to, or null for no record. */
  target_ref: string | null
  /** Handoff: who this task waits on (same ref space as assignee) + for what. */
}

// Small rotating palette for new owner avatars (mirrors /api/team-members).
const MEMBER_PALETTE = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange']

interface TargetInput {
  /** Stable client ref used to tie tasks to their target. */
  ref: string
  kind: TargetKind
  /** Existing record id — omit/null to create a new record from `new_fields`. Ignored for 'company'. */
  id?: string | null
  /**
   * Fields for a target being created. For 'lead' these are the candidate deal's
   * own facts — name, note, location, sector, estimated_value — plus
   * `origin_kind` ('project' | 'opportunity'), which picks the lead's queue lane
   * and nothing else. A lead is neither of those things yet; that is the point.
   */
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
    lead_ids: string[]
    party_ids: string[]
    task_ids: string[]
    document_ids: string[]
  } = {
    project_ids: [],
    opportunity_ids: [],
    lead_ids: [],
    party_ids: [],
    task_ids: [],
    document_ids: [],
  }

  // ── 1. Resolve targets → record ids (existing, create new, lead, or company) ─
  const resolved = new Map<string, ConfirmTarget>() // client ref → {kind, id}
  for (const t of body.targets ?? []) {
    if (!t || !t.ref) continue

    if (t.kind === 'company') {
      resolved.set(t.ref, { kind: 'company', id: 'company' })
    } else if (t.kind === 'lead') {
      if (!t.new_fields) continue
      // Follow-ups about THIS candidate deal travel with it as text, because
      // `tasks.lead_id` carries a UNIQUE index — one task per lead, reserved for
      // the bid-deadline sync latch. Three follow-ups about one site cannot all
      // be tasks, and keeping one of the three silently would be worse than
      // keeping none. They become real tasks when somebody promotes it and owns
      // it; see createLeadFromMeeting.
      const followUps = (body.task_actions ?? [])
        .filter((task) => task.include && task.target_ref === t.ref && str(task.title))
        .map((task) => task.title.trim())

      const f = t.new_fields
      const created = await createLeadFromMeeting(
        {
          name: str(f.name) ?? '',
          note: str(f.note),
          location: str(f.location),
          sector: str(f.sector),
          estimated_value: num(f.estimated_value),
          kind: f.origin_kind === 'opportunity' ? 'opportunity' : 'project',
        },
        {
          title: str(meeting.title) || session.label || 'meeting',
          date: str(meeting.date),
          minutes: str(meeting.minutes),
          followUps,
        }
      )
      if (created.id) resolved.set(t.ref, { kind: 'lead', id: created.id })
      else console.error('Meeting lead create failed:', created.error)
    } else if (t.kind === 'project' || t.kind === 'opportunity') {
      if (t.id) {
        resolved.set(t.ref, { kind: t.kind, id: t.id })
      } else if (t.new_fields) {
        const created = await createRecordFromFields(supabase, t.kind as RecordKind, t.new_fields, { source: 'Meeting intake' })
        if (created.id) {
          resolved.set(t.ref, { kind: t.kind, id: created.id })
        } else {
          console.error('Meeting target create failed:', created.error)
        }
      }
    }
  }

  const targets = Array.from(resolved.values())
  for (const tgt of targets) {
    if (tgt.kind === 'project') createdRecordIds.project_ids.push(tgt.id)
    else if (tgt.kind === 'opportunity') createdRecordIds.opportunity_ids.push(tgt.id)
    else if (tgt.kind === 'lead') createdRecordIds.lead_ids.push(tgt.id)
  }

  // ── 2. Attendees → parties (match/create) + promote owners → team_members ────
  const linkedPeople: { id: string; name: string; role: string | null }[] = []
  // Attendee ref → resolved team-member id, for tasks assigned to a new owner.
  const ownerMemberByRef = new Map<string, string>()

  /** Find-or-create the team_member linked to this contact (dedupe by party_id). */
  async function ensureOwner(partyId: string, name: string, email: string | null): Promise<string | null> {
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('party_id', partyId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (existing) return existing.id
    const color = MEMBER_PALETTE[Math.floor(Math.random() * MEMBER_PALETTE.length)]
    const { data, error } = await supabase
      .from('team_members')
      .insert({ name, email, party_id: partyId, color } as TablesInsert<'team_members'>)
      .select('id')
      .single()
    if (error) {
      console.error('Create team member from attendee failed:', error)
      return null
    }
    return data.id
  }

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

    // Promote to task owner: one team_member linked to this contact.
    if (p.owner && p.is_organization !== true && p.ref) {
      const memberId = await ensureOwner(partyId, p.name.trim(), str(p.email))
      if (memberId) ownerMemberByRef.set(p.ref, memberId)
    }
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
    // A lead already carries the meeting in its own note (createLeadFromMeeting)
    // and has no update feed, players list or document shelf to fan out onto.
    if (tgt.kind === 'lead') continue

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
    } else if (tgt.kind === 'opportunity') {
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
    if (docId) {
      createdRecordIds.document_ids.push(docId)
      // Company minutes have no update/note carrier — embed the doc directly so
      // Ber AI can retrieve it (project/opportunity targets embed via their feed).
      if (tgt.kind === 'company' && body_feed) {
        embedDocument(docId, null, docContent, null, true).catch(console.error)
      }
    }
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
      // A follow-up about a staged lead was already written into that lead's
      // note at creation. Creating it again here as an unlinked task would put
      // an orphan on somebody's board with no record to open.
      if (tgt?.kind === 'lead') continue
      // Resolve the owner: an attendee promoted this pass → a real member id →
      // finally the AI's free-text name as a fallback.
      let assigneeId: string | null = null
      const ref = t.assignee_ref
      if (ref?.startsWith('owner:')) {
        assigneeId = ownerMemberByRef.get(ref.slice('owner:'.length)) ?? null
      } else if (ref && memberIds.has(ref)) {
        assigneeId = ref
      }
      if (!assigneeId && t.assignee) {
        assigneeId = memberByName.get(t.assignee.toLowerCase()) ?? null
      }
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

  // ── 4b. Minutes reach the team through Drive ────────────────────────────────
  // Same reasoning as the email-intake confirm: most of the people who attended
  // the meeting cannot reach this tailnet-only platform. Company-scoped minutes
  // are excluded deliberately — they are governance material, not a record's
  // document set, and publishRecordToDrive has no company shelf.
  // ── Verbatim transcript, for a Meet session that was not filed at import ────
  //
  // When the meeting title named a record unambiguously, the importer already
  // filed the full export and this is a no-op. When it did not, this is the
  // moment the record becomes known — so the transcript lands now rather than
  // living only in Drive.
  //
  // One record, not every target: `drive_file_id` carries a platform-wide unique
  // index, so a Drive file can be filed exactly once. The minutes document still
  // goes on all of them; the verbatim goes on the first real record.
  if (session.drive_file_id && session.raw_text) {
    // A record first. A broker call that named a dozen sites has NO project or
    // opportunity — every one of them was staged as a lead, and a lead has no
    // document shelf. The transcript must still land somewhere: existing only
    // in Drive, unsearchable and unquotable, is the one outcome the import was
    // built to prevent.
    //
    // ⚠ BUT NOT ON THE COMPANY SHELF, which is where this used to send it.
    // A company-scoped chunk is handed to assessFit() as "RELEVANT BER WILSON
    // EVIDENCE", so a call about a dozen sites nobody chose to pursue would
    // have been scoring every future lead — and with ~25 more sites coming
    // from one broker, it would have become a large share of the corpus that
    // decides what Ber Wilson pursues. A transcript is a record of what was
    // said, not a claim about the company's capabilities. Reference keeps it
    // searchable without making it evidence.
    const onARecord = targets.find((t) => t.kind === 'project' || t.kind === 'opportunity')
    const primary: ConfirmTarget | null =
      onARecord ??
      (targets.some((t) => t.kind === 'company')
        ? ({ kind: 'company', id: 'company' } as ConfirmTarget)
        : targets.some((t) => t.kind === 'lead')
          ? ({ kind: 'reference', id: 'reference' } as unknown as ConfirmTarget)
          : null)
    if (primary) {
      // `name` is only used for the storage path/label; ConfirmTarget carries
      // just a kind and an id, and the meeting's own title is the better label.
      const label = str(meeting.title) || session.label || 'meeting'

      // ── Already filed? MOVE it rather than refusing ─────────────────────────
      //
      // ⚠ THIS IS THE STEP THE IMPORT'S "FILE EVERYTHING" CHANGE MADE NECESSARY.
      // The importer now files every transcript immediately — on the record when
      // the title matched, on the reference shelf when it did not — so by the
      // time anyone confirms, a document already exists for this Drive file.
      // `drive_file_id` carries a platform-wide unique index, so a plain
      // re-file attempt reports `alreadyFiled` and the transcript would sit on
      // the reference shelf forever while the reviewer believed they had filed
      // it on the deal.
      //
      // refileDocument re-points the chunks instead of rebuilding them: the text
      // has not changed, so the stored vectors are exactly valid at the new
      // address (§12) — instant and exact, where re-embedding is minutes of
      // contended GPU for identical numbers.
      const existing = await findFiledTranscript(supabase, session.drive_file_id)
      const wantsRecord = primary.kind === 'project' || primary.kind === 'opportunity'

      if (existing && wantsRecord && existing.shelf !== primary.kind) {
        try {
          const moved = await refileDocument(supabase, existing.documentId, {
            kind: primary.kind as 'project' | 'opportunity',
            id: primary.id,
          })
          createdRecordIds.document_ids.push(existing.documentId)
          console.log(
            `[meeting-confirm] moved the transcript from ${existing.shelf} to ${primary.kind} ${primary.id} (${moved.chunks} passages re-pointed)`
          )
        } catch (err) {
          // The transcript is still filed and still answering questions where it
          // is. Say so rather than failing a confirm that otherwise succeeded.
          console.error('[meeting-confirm] could not move the transcript:', err)
        }
      } else if (!existing) {
        const fileTarget: FileTarget =
          primary.kind === 'company'
            ? { kind: 'company', id: 'company', name: label }
            : (primary.kind as string) === 'reference'
              ? { kind: 'reference', id: 'reference', name: label }
              : { kind: primary.kind as 'project' | 'opportunity', id: primary.id, name: label }
        const filed = await fileMeetingDocument({
          target: fileTarget,
          driveFileId: session.drive_file_id,
          title: label,
          content: session.raw_text,
          summary: str(meeting.summary),
          meetingDate: str(meeting.date),
        }).catch((err) => {
          console.error('[meeting-confirm] verbatim filing failed:', err)
          return null
        })
        if (filed && !filed.alreadyFiled) createdRecordIds.document_ids.push(filed.documentId)
      }
    }
  }

  // ── 4c. The meeting record follows the reviewer's decision ──────────────────
  //
  // The importer wrote a `meetings` row with scope='unfiled' when the title
  // named no record. This is where it stops being unfiled — which matters
  // because `meetings` is the table the agent's search_meetings and
  // get_meeting_content tools read, and because the record's own Meetings tab
  // selects on project_id / opportunity_id.
  //
  // Only ONE record gets it, deliberately. A meeting is a single event; copying
  // the row onto every target would make one conversation read as several, and
  // the minutes document already goes on all of them.
  if (session.drive_file_id) {
    const { data: meetingRow } = await supabase
      .from('meetings')
      .select('id')
      .eq('drive_file_id', session.drive_file_id)
      .maybeSingle()
    const home = targets.find((t) => t.kind === 'project' || t.kind === 'opportunity')
    if (meetingRow && home) {
      const attendees = parseAttendees(
        linkedPeople.map((p) => ({ name: p.name, role: p.role, party_id: p.id }))
      )
      await attachMeetingToRecord(
        supabase,
        meetingRow.id,
        { kind: home.kind as 'project' | 'opportunity', id: home.id },
        {
          title: str(meeting.title),
          meetingDate: str(meeting.date),
          summary: str(meeting.summary),
          minutes: str(meeting.minutes),
          decisions: meeting.decisions,
          // Written through because confirming is what links an attendee to a
          // real contact — the import only had names out of a transcript.
          attendees: attendees.length > 0 ? attendees : undefined,
        }
      ).catch((err: unknown) => {
        console.error('[meeting-confirm] could not attach the meeting record:', err)
        return { moved: false }
      })

      // The transcript shows on the record's Meetings tab beside the minutes.
      // Opportunity documents have no meeting_id column — see the helper.
      if (home.kind === 'project') {
        const filedNow = await findFiledTranscript(supabase, session.drive_file_id)
        if (filedNow) await linkDocumentToMeeting(supabase, filedNow.documentId, meetingRow.id)
      }
    }
  }

  // ── 4d. The title becomes a filing key for the next call in the series ──────
  //
  // ⚠ LEARNED FROM THE HUMAN'S DECISION, NEVER FROM THE MATCHER'S OWN (§12: a
  // matcher must never learn from its own matches — self-teaching compounds).
  // This runs only on a confirm, which is a person saying "this call belongs
  // here", and it is what makes a recurring deal call file itself from its
  // second occurrence onward instead of waiting in the queue every time.
  const learnFrom = targets.find((t) => t.kind === 'project' || t.kind === 'opportunity')
  if (learnFrom) {
    const titleForLearning = str(meeting.title) || session.label
    if (titleForLearning) {
      const learned = await learnMeetingTitles(
        meetingTargetFromTitle(titleForLearning),
        learnFrom.kind as 'project' | 'opportunity',
        learnFrom.id
      ).catch(() => [] as string[])
      if (learned.length > 0) {
        console.log(
          `[meeting-confirm] learned meeting title(s) for ${learnFrom.kind} ${learnFrom.id}: ${learned.join(', ')}`
        )
      }
    }
  }

  const publishable = targets.filter(
    (t) => t.kind === 'project' || t.kind === 'opportunity'
  )
  if (publishable.length > 0) {
    void (async () => {
      for (const tgt of publishable) {
        try {
          await publishRecordToDrive(tgt.kind as 'project' | 'opportunity', tgt.id)
        } catch (err) {
          // Best-effort — the nightly reconcile retries.
          console.error(
            '[meeting-intake] Drive publish failed:',
            err instanceof Error ? err.message : err
          )
        }
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

  const singleTarget = targets.length === 1 ? targets[0] : null
  const redirect = singleTarget
    ? singleTarget.kind === 'project'
      ? `/projects/${singleTarget.id}`
      : singleTarget.kind === 'opportunity'
        ? `/opportunities/${singleTarget.id}`
        : singleTarget.kind === 'lead'
          ? `/leads?lead=${singleTarget.id}`
          : '/company'
    : // A site-selection call stages several leads and touches no record. The
      // queue is where the reader continues, and it is the one destination that
      // holds all of them.
      createdRecordIds.lead_ids.length > 0 &&
        createdRecordIds.project_ids.length === 0 &&
        createdRecordIds.opportunity_ids.length === 0
      ? '/leads'
      : targets.length === 0 && createdRecordIds.task_ids.length > 0
        ? '/tasks' // pure executive-team meeting — land on the task board
        : null
  return Response.json({
    ok: true,
    // Leads are counted apart: nothing was UPDATED for them, they were staged.
    records_updated: targets.filter((t) => t.kind !== 'lead').length,
    leads_staged: createdRecordIds.lead_ids.length,
    tasks_created: createdRecordIds.task_ids.length,
    parties_created: createdRecordIds.party_ids.length,
    documents_created: createdRecordIds.document_ids.length,
    redirect,
  })
}
