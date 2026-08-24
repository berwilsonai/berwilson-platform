'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Pencil, Trash2, CheckCircle2, RotateCcw, Lock, Sparkles, Loader2, AudioLines } from 'lucide-react'
import { toast } from 'sonner'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import MeetingFiles from './MeetingFiles'
import {
  MEETING_KIND_BADGE,
  MEETING_KIND_LABELS,
  MEETING_STATUS_BADGE,
  MEETING_STATUS_LABELS,
  meetingKind,
  meetingStatus,
  parseAttendees,
  parseDecisions,
} from '@/lib/utils/meetings'
import type { Meeting, Document } from '@/lib/supabase/types'

function fmtDate(date: string | null): string {
  if (!date) return '—'
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

interface Props {
  meeting: Meeting
  files: Document[]
  onFilesChange: (files: Document[]) => void
  canEdit: boolean
  canDelete: boolean
  onBack: () => void
  onEdit: () => void
  onChanged: (meeting: Meeting) => void
  onDeleted: (id: string) => void
}

export default function MeetingDetail({ meeting, files, onFilesChange, canEdit, canDelete, onBack, onEdit, onChanged, onDeleted }: Props) {
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [transStatus, setTransStatus] = useState<string | null>(meeting.transcription_status)

  const kind = meetingKind(meeting.kind)
  const status = meetingStatus(meeting.status)
  const board = meeting.scope === 'company'
  const attendees = parseAttendees(meeting.attendees)
  const decisions = parseDecisions(meeting.decisions)
  const audioDoc = files.find((f) => f.mime_type?.startsWith('audio/') || f.mime_type?.startsWith('video/')) ?? null
  const hasTranscript = !!meeting.transcript?.trim()

  // Poll while a transcription is running; on finish, pull the updated meeting
  // (transcript + auto-summary) and files (the new transcript document) up to
  // the parent. setState happens only in the async callback (lint-clean).
  useEffect(() => {
    if (transStatus !== 'processing') return
    let active = true
    const poll = async () => {
      try {
        const res = await fetch(`/api/meetings/${meeting.id}`)
        if (!res.ok || !active) return
        const data = await res.json()
        const ns: string | null = data.meeting?.transcription_status ?? null
        if (ns && ns !== 'processing') {
          setTransStatus(ns)
          onChanged(data.meeting as Meeting)
          if (Array.isArray(data.files)) onFilesChange(data.files as Document[])
          if (ns === 'complete') toast.success('Transcript ready.')
          if (ns === 'error') toast.error('Transcription failed — you can try again.')
        }
      } catch {
        /* transient — keep polling */
      }
    }
    const iv = setInterval(poll, 5000)
    poll()
    return () => {
      active = false
      clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transStatus, meeting.id])

  async function transcribe(force: boolean) {
    if (!audioDoc) {
      toast.info('Attach an audio recording first.')
      return
    }
    const res = await fetch(`/api/meetings/${meeting.id}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: audioDoc.id, force }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error ?? 'Could not start transcription.')
      return
    }
    if (data.skipped) {
      toast.info('This recording is already transcribed — use Re-transcribe to run it again.')
      return
    }
    setTransStatus('processing')
    onChanged({ ...meeting, transcription_status: 'processing' } as Meeting)
    toast.success('Transcribing… this can take a few minutes.')
  }

  async function handleAudioUploaded(doc: Document) {
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: doc.id }),
      })
      const data = await res.json()
      if (res.ok && data.status === 'processing') {
        setTransStatus('processing')
        onChanged({ ...meeting, transcription_status: 'processing' } as Meeting)
        toast.success('Transcribing the recording…')
      }
    } catch {
      /* non-fatal — they can transcribe manually */
    }
  }

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Update failed.')
        return
      }
      toast.success(okMsg)
      onChanged(data.meeting as Meeting)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    const res = await fetch(`/api/meetings/${meeting.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Delete failed.')
      return
    }
    toast.success('Meeting record deleted.')
    onDeleted(meeting.id)
  }

  const facts: [string, string | null][] = [
    ['Date', fmtDate(meeting.meeting_date)],
    ['Time', meeting.meeting_time],
    ['Location', meeting.location],
  ]
  if (board) {
    facts.push(['Type', meeting.meeting_type_label], ['Chair', meeting.chair], ['Secretary', meeting.secretary])
  }
  if (meeting.approved_at) {
    facts.push(['Approved by', meeting.approved_by])
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to list
      </button>

      <Panel>
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{meeting.title}</h1>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <Chip tone={MEETING_KIND_BADGE[kind]}>{MEETING_KIND_LABELS[kind]}</Chip>
                <Chip tone={MEETING_STATUS_BADGE[status]}>{MEETING_STATUS_LABELS[status]}</Chip>
                {meeting.confidential && (
                  <Chip tone="bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/60">
                    <Lock size={11} /> Confidential
                  </Chip>
                )}
                {meeting.index_ai && (
                  <Chip tone="bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800/60">
                    <Sparkles size={11} /> In Ber AI
                  </Chip>
                )}
              </div>
            </div>
            {canEdit && (
              <Button variant="outline" onClick={onEdit} disabled={busy} className="shrink-0">
                <Pencil size={14} /> Edit
              </Button>
            )}
          </div>

          {/* Facts */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 rounded-md bg-muted/30 p-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <div className="label-caps text-muted-foreground">{label}</div>
                <div className="text-sm">{value || '—'}</div>
              </div>
            ))}
          </div>

          {/* Attendees */}
          {attendees.length > 0 && (
            <div>
              <div className="label-caps text-muted-foreground mb-1">Attendees</div>
              <ul className="text-sm space-y-0.5">
                {attendees.map((a, i) => (
                  <li key={i}>
                    {a.name}
                    {(a.role || a.org) && <span className="text-muted-foreground"> — {[a.role, a.org].filter(Boolean).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Summary */}
          {meeting.summary && (
            <div>
              <div className="label-caps text-muted-foreground mb-1">Summary</div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{meeting.summary}</p>
            </div>
          )}

          {/* Decisions */}
          {decisions.length > 0 && (
            <div>
              <div className="label-caps text-muted-foreground mb-1">{board ? 'Resolutions' : 'Decisions'}</div>
              <ul className="text-sm space-y-1 list-disc pl-5">
                {decisions.map((d, i) => (
                  <li key={i} className="whitespace-pre-wrap">{d}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Minutes */}
          {meeting.minutes && (
            <div>
              <div className="label-caps text-muted-foreground mb-1">{board ? 'Minutes' : 'Notes'}</div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{meeting.minutes}</p>
            </div>
          )}

          {/* Transcript (collapsed) */}
          {meeting.transcript && (
            <details className="rounded-md bg-muted/30 p-3">
              <summary className="text-sm font-medium cursor-pointer">Transcript</summary>
              <p className="text-sm whitespace-pre-wrap leading-relaxed mt-2 text-muted-foreground">{meeting.transcript}</p>
            </details>
          )}
        </div>
      </Panel>

      {/* Attachments */}
      <Panel>
        <PanelHeader label="Recordings & files" count={files.length} />
        <div className="p-4 space-y-3">
          {audioDoc && canEdit && (
            <div className="rounded-md bg-muted/30 p-3 flex items-center gap-2 text-sm">
              {transStatus === 'processing' ? (
                <>
                  <Loader2 size={15} className="animate-spin text-muted-foreground shrink-0" />
                  <span>Transcribing the recording with Whisper — this can take a few minutes. It appears below and in the transcript when ready.</span>
                </>
              ) : transStatus === 'error' ? (
                <>
                  <span className="flex-1 text-red-600 dark:text-red-400">Transcription failed.</span>
                  <Button variant="outline" onClick={() => transcribe(true)} className="h-7">Try again</Button>
                </>
              ) : hasTranscript ? (
                <>
                  <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="flex-1">Transcript ready (Whisper).</span>
                  <Button variant="outline" onClick={() => transcribe(true)} className="h-7">Re-transcribe</Button>
                </>
              ) : (
                <>
                  <AudioLines size={15} className="text-muted-foreground shrink-0" />
                  <span className="flex-1">Recording attached — not transcribed yet.</span>
                  <Button onClick={() => transcribe(false)} className="h-7">Transcribe</Button>
                </>
              )}
            </div>
          )}
          <MeetingFiles
            meetingId={meeting.id}
            files={files}
            canEdit={canEdit}
            onChange={onFilesChange}
            onAudioUploaded={handleAudioUploaded}
          />
        </div>
      </Panel>

      {/* Actions */}
      {(canEdit || canDelete) && (
        <div className="flex items-center gap-2">
          {canEdit && status === 'draft' && (
            <Button onClick={() => patch({ status: 'approved' }, 'Meeting approved.')} disabled={busy}>
              <CheckCircle2 size={14} /> Mark approved
            </Button>
          )}
          {canEdit && status === 'approved' && (
            <Button variant="outline" onClick={() => patch({ status: 'draft' }, 'Reopened as draft.')} disabled={busy}>
              <RotateCcw size={14} /> Reopen as draft
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => patch({ index_ai: !meeting.index_ai }, meeting.index_ai ? 'Removed from Ber AI.' : 'Added to Ber AI.')} disabled={busy}>
              <Sparkles size={14} /> {meeting.index_ai ? 'Remove from Ber AI' : 'Add to Ber AI'}
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={busy} className="ml-auto">
              <Trash2 size={14} /> Delete
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this meeting record?"
        description="This permanently removes the record and its attached recordings, transcript, and files. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
