'use client'

import { useState } from 'react'
import { Plus, CalendarDays, Lock, Mic, Paperclip } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import EmptyState from '@/components/shared/EmptyState'
import MeetingForm from './MeetingForm'
import MeetingDetail from './MeetingDetail'
import type { TeamMemberOption, ContactOption } from './MeetingAttendees'
import {
  MEETING_KIND_BADGE,
  MEETING_KIND_LABELS,
  MEETING_STATUS_BADGE,
  MEETING_STATUS_LABELS,
  meetingKind,
  meetingStatus,
  parseAttendees,
  type MeetingScope,
} from '@/lib/utils/meetings'
import type { Meeting, Document } from '@/lib/supabase/types'

function fmtDate(date: string | null): string {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Mode = 'list' | 'new' | { view: string } | { edit: string }

interface Props {
  scope: MeetingScope
  projectId?: string
  opportunityId?: string
  initialMeetings: Meeting[]
  initialFiles: Document[]
  teamMembers: TeamMemberOption[]
  contacts: ContactOption[]
  canEdit: boolean
  canDelete: boolean
}

export default function MeetingsView({ scope, projectId, opportunityId, initialMeetings, initialFiles, teamMembers, contacts, canEdit, canDelete }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings)
  const [files, setFiles] = useState<Document[]>(initialFiles)
  const [mode, setMode] = useState<Mode>('list')

  const board = scope === 'company'
  const filesFor = (id: string) => files.filter((f) => f.meeting_id === id)
  const findMeeting = (id: string) => meetings.find((m) => m.id === id) ?? null

  function setFilesForMeeting(meetingId: string, next: Document[]) {
    setFiles((prev) => [...prev.filter((f) => f.meeting_id !== meetingId), ...next])
  }

  function handleSaved(m: Meeting) {
    setMeetings((prev) => {
      const exists = prev.some((x) => x.id === m.id)
      return exists ? prev.map((x) => (x.id === m.id ? m : x)) : [m, ...prev]
    })
    setMode({ view: m.id })
  }

  function handleChanged(m: Meeting) {
    setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x)))
  }

  function handleDeleted(id: string) {
    setMeetings((prev) => prev.filter((x) => x.id !== id))
    setFiles((prev) => prev.filter((f) => f.meeting_id !== id))
    setMode('list')
  }

  // ── Form (new / edit) ──────────────────────────────────────────────────────
  if (mode === 'new' || (typeof mode === 'object' && 'edit' in mode)) {
    const editing = typeof mode === 'object' && 'edit' in mode ? findMeeting(mode.edit) : null
    return (
      <MeetingForm
        scope={scope}
        projectId={projectId}
        opportunityId={opportunityId}
        meeting={editing}
        teamMembers={teamMembers}
        contacts={contacts}
        onSaved={handleSaved}
        onCancel={() => setMode(editing ? { view: editing.id } : 'list')}
      />
    )
  }

  // ── Detail ─────────────────────────────────────────────────────────────────
  if (typeof mode === 'object' && 'view' in mode) {
    const m = findMeeting(mode.view)
    if (!m) {
      setMode('list')
      return null
    }
    return (
      <MeetingDetail
        meeting={m}
        files={filesFor(m.id)}
        onFilesChange={(next) => setFilesForMeeting(m.id, next)}
        canEdit={canEdit}
        canDelete={canDelete}
        onBack={() => setMode('list')}
        onEdit={() => setMode({ edit: m.id })}
        onChanged={handleChanged}
        onDeleted={handleDeleted}
      />
    )
  }

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {board
            ? 'Board & governance meeting records — minutes, resolutions, recordings.'
            : `Client interactions — meetings, calls, and site visits on this ${scope === 'opportunity' ? 'opportunity' : 'project'}.`}
        </p>
        {canEdit && (
          <button
            onClick={() => setMode('new')}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> {board ? 'New board meeting' : 'New meeting'}
          </button>
        )}
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={board ? 'No board meetings recorded' : 'No meetings logged'}
          description={
            board
              ? 'Record board and governance meetings — attach the recording and minutes for compliance.'
              : 'Log client meetings, calls, and site visits — attach the recording and a transcript.'
          }
          action={
            canEdit ? (
              <button
                onClick={() => setMode('new')}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} /> {board ? 'Record a meeting' : 'Log a meeting'}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => {
            const kind = meetingKind(m.kind)
            const status = meetingStatus(m.status)
            const attendeeCount = parseAttendees(m.attendees).length
            const fileCount = filesFor(m.id).length
            const hasAudio = filesFor(m.id).some((f) => f.mime_type?.startsWith('audio/'))
            return (
              <Panel key={m.id} interactive className="cursor-pointer" onClick={() => setMode({ view: m.id })}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold truncate">{m.title}</h3>
                        {m.confidential && <Lock size={13} className="text-red-500 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        <Chip tone={MEETING_KIND_BADGE[kind]}>{MEETING_KIND_LABELS[kind]}</Chip>
                        <Chip tone={MEETING_STATUS_BADGE[status]}>{MEETING_STATUS_LABELS[status]}</Chip>
                        <span className="text-xs text-muted-foreground">{fmtDate(m.meeting_date)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                      {hasAudio && <Mic size={13} />}
                      {fileCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={12} /> {fileCount}
                        </span>
                      )}
                      {attendeeCount > 0 && <span>{attendeeCount} present</span>}
                    </div>
                  </div>
                  {m.summary && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{m.summary}</p>}
                </div>
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}
