'use client'

import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Mic, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Field, Input, FieldDate } from '@/components/ui/field'

/**
 * Upload a recording onto this record — the door where the filing is certain.
 *
 * ⚠ ONE COMPONENT FOR BOTH RECORD KINDS, because the two differ only in which
 * id goes in the form (§12: a shared renderer wired to one surface is worse
 * than no shared renderer, and the opportunity side of this app has repeatedly
 * got the thinner copy of a project feature).
 *
 * ⚠ IT TELLS THE TRUTH ABOUT HOW LONG IT TAKES. Whisper runs on this machine,
 * one request at a time, and a 67-minute meeting measured 97 seconds — so a
 * spinner with no explanation reads as a hang and gets cancelled halfway. The
 * copy says what is happening and that the tab can be left open.
 */

interface RecordingUploadProps {
  target: { kind: 'project' | 'opportunity'; id: string }
  /** Called once the record has new rows worth re-reading. */
  onDone?: () => void
}

interface UploadOutcome {
  meeting_id: string | null
  transcript_chars: number
  phases: { commitments: number; tasksCreated: number; updatesPosted: number; meetingsFiled: number }
  created: { kind: string; id: string; name: string }[]
  notes: string[]
}

export default function RecordingUpload({ target, onDone }: RecordingUploadProps) {
  const fileId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [occurredOn, setOccurredOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<UploadOutcome | null>(null)

  async function submit() {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    setDone(null)

    const body = new FormData()
    body.set('file', file)
    body.set(target.kind === 'project' ? 'project_id' : 'opportunity_id', target.id)
    if (title.trim()) body.set('title', title.trim())
    if (occurredOn) body.set('occurred_on', occurredOn)

    try {
      const res = await fetch('/api/records/recording', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The route returns a sentence a person can act on; show it verbatim.
        setError(json.error ?? `Upload failed (${res.status}).`)
        return
      }
      setDone(json as UploadOutcome)
      setFile(null)
      setTitle('')
      setOccurredOn('')
      if (inputRef.current) inputRef.current.value = ''
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="p-4 space-y-3">
      <div className="flex items-center gap-1.5 label-caps text-muted-foreground">
        <Mic size={13} /> Upload a recording
      </div>
      <p className="text-xs text-muted-foreground">
        Transcribed on this machine and filed on this record — no matching, so it cannot land on
        the wrong deal. Obligations, follow-up tasks and a meeting entry come with it.
      </p>

      <Field label="Audio or video file" id={fileId}>
        <input
          ref={inputRef}
          id={fileId}
          type="file"
          accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setError(null)
          }}
          className="block w-full text-sm text-foreground file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-xs file:font-medium hover:file:bg-accent file:transition-colors focus-visible:outline-none"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What to call it" hint="Defaults to the file name">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Site walk with Baha"
            disabled={busy}
          />
        </Field>
        <Field label="When it happened" hint="Defaults to today">
          <FieldDate value={occurredOn} onChange={setOccurredOn} />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!file || busy}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground elev-1 text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
          {busy ? 'Transcribing…' : 'Transcribe and file'}
        </button>
        {busy && (
          <span className="text-xs text-muted-foreground">
            Transcribing, then reading it for obligations and follow-ups — about three minutes,
            longer for a long call. You can leave this tab open.
          </span>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      {done && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <CheckCircle2 size={13} /> Filed on this record
          </p>
          <p className="text-xs text-muted-foreground">
            {done.transcript_chars.toLocaleString()} characters transcribed and indexed
            {done.phases.commitments > 0 && `, ${done.phases.commitments} obligation${done.phases.commitments === 1 ? '' : 's'}`}
            {done.phases.tasksCreated > 0 && `, ${done.phases.tasksCreated} task${done.phases.tasksCreated === 1 ? '' : 's'} on the board`}
            .
          </p>
          {done.meeting_id && (
            <p className="text-xs text-muted-foreground">
              A meeting entry was added — confirm it at{' '}
              <Link href="/decide" className="underline underline-offset-2 hover:text-foreground">
                /decide
              </Link>{' '}
              to link the people.
            </p>
          )}
          {done.created.length > 0 && (
            <p className="text-xs text-foreground">
              It also named{' '}
              {done.created.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link
                    href={c.kind === 'project' ? `/projects/${c.id}` : `/opportunities/${c.id}`}
                    className="underline underline-offset-2"
                  >
                    {c.name}
                  </Link>
                </span>
              ))}
              , which {done.created.length === 1 ? 'was' : 'were'} created.
            </p>
          )}
          {done.notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      )}
    </Panel>
  )
}
