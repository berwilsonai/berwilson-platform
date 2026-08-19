'use client'

import { useRef, useState } from 'react'
import { Plus, Trash2, Sparkles, Loader2, Mic, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import MeetingAttendees, { type TeamMemberOption, type ContactOption } from './MeetingAttendees'
import {
  BOARD_KINDS,
  PROJECT_KINDS,
  OPPORTUNITY_KINDS,
  MEETING_KIND_LABELS,
  parseAttendees,
  parseDecisions,
  type MeetingAttendee,
  type MeetingKind,
  type MeetingScope,
} from '@/lib/utils/meetings'
import type { Meeting } from '@/lib/supabase/types'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const areaClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1'

interface Props {
  scope: MeetingScope
  projectId?: string
  opportunityId?: string
  /** Existing meeting to edit, or null to create. */
  meeting: Meeting | null
  teamMembers: TeamMemberOption[]
  contacts: ContactOption[]
  onSaved: (meeting: Meeting) => void
  onCancel: () => void
}

export default function MeetingForm({ scope, projectId, opportunityId, meeting, teamMembers, contacts, onSaved, onCancel }: Props) {
  const board = scope === 'company'
  const kinds = board ? BOARD_KINDS : scope === 'opportunity' ? OPPORTUNITY_KINDS : PROJECT_KINDS

  const [title, setTitle] = useState(meeting?.title ?? '')
  const [kind, setKind] = useState<MeetingKind>((meeting?.kind as MeetingKind) ?? (board ? 'board' : 'client'))
  const [meetingDate, setMeetingDate] = useState(meeting?.meeting_date ?? '')
  const [meetingTime, setMeetingTime] = useState(meeting?.meeting_time ?? '')
  const [location, setLocation] = useState(meeting?.location ?? '')
  const [typeLabel, setTypeLabel] = useState(meeting?.meeting_type_label ?? '')
  const [chair, setChair] = useState(meeting?.chair ?? '')
  const [secretary, setSecretary] = useState(meeting?.secretary ?? '')
  const [attendees, setAttendees] = useState<MeetingAttendee[]>(parseAttendees(meeting?.attendees))
  const [transcript, setTranscript] = useState(meeting?.transcript ?? '')
  const [summary, setSummary] = useState(meeting?.summary ?? '')
  const [minutes, setMinutes] = useState(meeting?.minutes ?? '')
  const [decisions, setDecisions] = useState<string[]>(parseDecisions(meeting?.decisions))
  const [status, setStatus] = useState(meeting?.status ?? 'draft')
  const [confidential, setConfidential] = useState(meeting?.confidential ?? false)
  const [indexAi, setIndexAi] = useState(meeting?.index_ai ?? !board)

  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  // Recording picked at create time — uploaded + transcribed right after the
  // record is created (the one-shot "upload → transcribe → summary" flow).
  const [recording, setRecording] = useState<File | null>(null)
  const recordingInputRef = useRef<HTMLInputElement>(null)

  async function handleDraft() {
    if (!transcript.trim()) {
      toast.info('Paste a transcript first, then draft a summary from it.')
      return
    }
    setDrafting(true)
    try {
      const res = await fetch('/api/meetings/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, title: title || null, meeting_date: meetingDate || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Could not draft from the transcript.')
        return
      }
      const ex = data.extraction as {
        title?: string | null
        summary?: string
        minutes?: string | null
        decisions?: string[]
        attendees?: { name: string; role?: string | null; title?: string | null; company?: string | null }[]
      }
      if (!title && ex.title) setTitle(ex.title)
      if (ex.summary) setSummary(ex.summary)
      if (ex.minutes) setMinutes(ex.minutes)
      if (ex.decisions?.length) setDecisions(ex.decisions)
      if (ex.attendees?.length) {
        setAttendees(
          ex.attendees.map((a) => ({
            name: a.name,
            role: a.role ?? a.title ?? null,
            org: a.company ?? null,
            party_id: null,
            team_member_id: null,
          })),
        )
      }
      toast.success('Drafted from the transcript — review and edit before saving.')
    } finally {
      setDrafting(false)
    }
  }

  /** Upload the recording to the freshly-created meeting and start transcription.
   *  Returns true if Whisper transcription was kicked off. Non-fatal — a failed
   *  upload just means they can add the recording from the record afterwards. */
  async function uploadRecording(meetingId: string, file: File): Promise<boolean> {
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `meetings/${meetingId}/${Date.now()}_${safeName}`

      const signRes = await fetch('/api/documents/signed-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: path }),
      })
      const signData = await signRes.json()
      if (!signRes.ok) {
        toast.error(signData.error ?? 'Could not start the recording upload.')
        return false
      }

      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from('documents')
        .uploadToSignedUrl(signData.path, signData.token, file)
      if (upErr) {
        toast.error(`Recording upload failed: ${upErr.message}`)
        return false
      }

      const regRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: meetingId,
          storage_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type || null,
          doc_type: 'other',
          extract_ai: false,
        }),
      })
      const regData = await regRes.json()
      if (!regRes.ok) {
        toast.error(regData.error ?? 'Could not register the recording.')
        return false
      }

      const trRes = await fetch(`/api/meetings/${meetingId}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: regData.document.id }),
      })
      const trData = await trRes.json().catch(() => ({}))
      if (trRes.ok && trData.status === 'processing') {
        toast.success('Recording uploaded — transcribing with Whisper…')
        return true
      }
      // Uploaded but transcription unavailable (e.g. Whisper off) — still fine.
      toast.success('Recording uploaded.')
      return false
    } catch {
      toast.error('Recording upload failed — you can add it from the record.')
      return false
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error('A meeting title is required.')
      return
    }
    if (!meetingDate) {
      toast.error('A meeting date is required.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        scope,
        project_id: scope === 'project' ? projectId : null,
        opportunity_id: scope === 'opportunity' ? opportunityId : null,
        kind,
        title: title.trim(),
        meeting_date: meetingDate,
        meeting_time: meetingTime || null,
        location: location || null,
        meeting_type_label: board ? typeLabel || null : null,
        chair: board ? chair || null : null,
        secretary: board ? secretary || null : null,
        attendees: attendees.filter((a) => a.name.trim()),
        transcript: transcript || null,
        summary: summary || null,
        minutes: minutes || null,
        decisions: decisions.filter((d) => d.trim()),
        status,
        confidential,
        index_ai: indexAi,
      }
      const res = await fetch(meeting ? `/api/meetings/${meeting.id}` : '/api/meetings', {
        method: meeting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Could not save the meeting.')
        return
      }
      let saved = data.meeting as Meeting
      toast.success(meeting ? 'Meeting updated.' : 'Meeting record created.')

      // One-shot: on create, upload the picked recording + kick off Whisper.
      if (!meeting && recording) {
        const transcribing = await uploadRecording(saved.id, recording)
        if (transcribing) saved = { ...saved, transcription_status: 'processing' } as Meeting
      }
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel>
      <PanelHeader label={meeting ? 'Edit meeting' : board ? 'New board meeting' : 'New meeting record'} />
      <div className="p-4 space-y-4 max-w-3xl">
        {/* Title + kind */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className={labelClass}>Title *</label>
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={board ? 'e.g. Special Board Meeting — executive decision' : 'e.g. Owner review — schedule + change orders'}
            />
          </div>
          <div>
            <label className={labelClass}>Type</label>
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as MeetingKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {MEETING_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date / time / location */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Date *</label>
            <DatePicker value={meetingDate} onChange={setMeetingDate} />
          </div>
          <div>
            <label className={labelClass}>Time</label>
            <input className={inputClass} value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} placeholder="e.g. 10 AM MST" />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Little America, SLC / Call" />
          </div>
        </div>

        {/* Board-only governance fields */}
        {board && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Meeting type label</label>
              <input className={inputClass} value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} placeholder="e.g. Special Board Meeting" />
            </div>
            <div>
              <label className={labelClass}>Chair</label>
              <input className={inputClass} value={chair} onChange={(e) => setChair(e.target.value)} placeholder="e.g. Nancy Norton" />
            </div>
            <div>
              <label className={labelClass}>Secretary</label>
              <input className={inputClass} value={secretary} onChange={(e) => setSecretary(e.target.value)} placeholder="e.g. Ericson Tua'one" />
            </div>
          </div>
        )}

        {/* Attendees */}
        <div>
          <label className={labelClass}>Attendees</label>
          <MeetingAttendees attendees={attendees} onChange={setAttendees} teamMembers={teamMembers} contacts={contacts} />
        </div>

        {/* Recording (create only) — one-shot upload + Whisper transcription */}
        {!meeting && (
          <div>
            <label className={labelClass}>Recording (audio or video)</label>
            {recording ? (
              <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 h-9 text-sm">
                <Mic size={14} className="text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{recording.name}</span>
                <button
                  type="button"
                  onClick={() => { setRecording(null); if (recordingInputRef.current) recordingInputRef.current.value = '' }}
                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                  aria-label="Remove recording"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => recordingInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent"
              >
                <Mic size={14} /> Choose a recording…
              </button>
            )}
            <input
              ref={recordingInputRef}
              type="file"
              accept="audio/*,video/*"
              className="sr-only"
              onChange={(e) => setRecording(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Your recording uploads and transcribes automatically after you create the record — a raw transcript and summary are written by local Whisper on the Studio.
            </p>
          </div>
        )}

        {/* Transcript */}
        <div>
          <label className={labelClass}>Transcript / script</label>
          <textarea
            className={areaClass}
            rows={5}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Optional — paste a transcript here, or upload a recording above and Whisper writes it for you. You can also add the recording from the record after saving."
          />
          {!board && (
            <div className="mt-2">
              <button
                type="button"
                onClick={handleDraft}
                disabled={drafting}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Draft summary from transcript
              </button>
            </div>
          )}
        </div>

        {/* Summary */}
        <div>
          <label className={labelClass}>Summary</label>
          <textarea className={areaClass} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A short executive skim of the meeting." />
        </div>

        {/* Minutes / notes */}
        <div>
          <label className={labelClass}>{board ? 'Minutes (authoritative)' : 'Notes'}</label>
          <textarea
            className={areaClass}
            rows={board ? 10 : 5}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder={board ? 'The authoritative minutes — paste or write the exact record.' : 'What was discussed, positions, open items.'}
          />
        </div>

        {/* Decisions / resolutions */}
        <div>
          <label className={labelClass}>{board ? 'Resolutions' : 'Decisions'}</label>
          <div className="space-y-2">
            {decisions.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={`${inputClass} flex-1`}
                  value={d}
                  onChange={(e) => setDecisions((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                  placeholder={board ? 'RESOLVED: …' : 'Decision reached'}
                />
                <button
                  type="button"
                  onClick={() => setDecisions((prev) => prev.filter((_, idx) => idx !== i))}
                  className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                  aria-label="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDecisions((prev) => [...prev, ''])}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent"
            >
              <Plus size={13} /> Add {board ? 'resolution' : 'decision'}
            </button>
          </div>
        </div>

        {/* Status + flags */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className={labelClass}>Status</label>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm h-9">
            <input type="checkbox" className="rounded" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
            Confidential
          </label>
          <label className="flex items-center gap-2 text-sm h-9">
            <input type="checkbox" className="rounded" checked={indexAi} onChange={(e) => setIndexAi(e.target.checked)} />
            Include in Ber AI search
          </label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          {board
            ? 'Board minutes default to NOT searchable by Ber AI. Turn on only if you want the assistant to retrieve this record.'
            : 'Project interactions are searchable by Ber AI by default so you can ask about them later.'}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : meeting ? 'Save changes' : 'Create record'}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </Panel>
  )
}
