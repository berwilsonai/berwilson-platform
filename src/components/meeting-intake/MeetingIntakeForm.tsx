'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FileUp, Sparkles, CalendarDays, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'

interface CalEventAttendee { name: string; email: string | null }
interface CalEvent { id: string; subject: string; date: string | null; when: string; attendees: CalEventAttendee[] }

/**
 * Paste-or-upload entry point for Meeting Notes Intake. Paste the raw notes /
 * transcript (or drop a .md/.txt file, read client-side), give it a title and the
 * meeting date, and we POST to /api/meeting-intake/analyze, then route to the
 * multi-target review screen.
 */
export default function MeetingIntakeForm() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Calendar prefill
  const [calEvents, setCalEvents] = useState<CalEvent[] | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [seedAttendees, setSeedAttendees] = useState<CalEventAttendee[]>([])

  async function loadCalendar() {
    setCalOpen(true)
    if (calEvents) return
    setCalLoading(true)
    try {
      const res = await fetch('/api/meeting-intake/calendar-events')
      const data = await res.json()
      setCalEvents(data.events ?? [])
      if (data.error) toast.error(data.error)
    } catch {
      setCalEvents([])
      toast.error('Could not load calendar events.')
    } finally {
      setCalLoading(false)
    }
  }

  function pickEvent(e: CalEvent) {
    setTitle(e.subject)
    if (e.date) setMeetingDate(e.date)
    setSeedAttendees(e.attendees)
    setCalOpen(false)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const content = await file.text()
    setText(content)
    if (!title) setTitle(file.name.replace(/\.(md|txt|markdown)$/i, ''))
  }

  async function analyze() {
    if (!text.trim()) {
      setError('Paste the meeting notes or choose a file first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/meeting-intake/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_text: text,
          title: title.trim() || null,
          meeting_date: meetingDate || null,
          seed_attendees: seedAttendees.length ? seedAttendees : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed.')
      router.push(`/intake/meeting/${data.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title (e.g. Leadership sync)"
          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="w-full sm:w-44">
          <DatePicker value={meetingDate} onChange={setMeetingDate} placeholder="Meeting date" className="h-9" />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,.markdown,text/markdown,text/plain"
          onChange={onFile}
          className="hidden"
        />
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={loadCalendar}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors w-full"
          >
            {calLoading ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
            From calendar
          </button>
          {calOpen && (
            <div className="absolute right-0 z-30 mt-1 w-80 max-h-80 overflow-auto rounded-md border border-border bg-card shadow-lg">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="label-caps text-muted-foreground">Recent meetings</span>
                <button type="button" onClick={() => setCalOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
              </div>
              {calLoading ? (
                <div className="px-3 py-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
              ) : calEvents && calEvents.length > 0 ? (
                calEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => pickEvent(e)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors border-b border-border/50 last:border-0"
                  >
                    <span className="text-sm font-medium truncate w-full">{e.subject}</span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-2">
                      <span>{e.when}</span>
                      {e.attendees.length > 0 && <span className="inline-flex items-center gap-0.5"><Users size={10} /> {e.attendees.length}</span>}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">No recent calendar meetings found.</div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors shrink-0"
        >
          <FileUp size={14} />
          {fileName ? 'Change file' : 'Upload .md / .txt'}
        </button>
      </div>

      {fileName && (
        <p className="text-xs text-muted-foreground">
          Loaded <span className="font-medium text-foreground">{fileName}</span> — edit below if needed.
        </p>
      )}

      {seedAttendees.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Users size={12} /> Attendees from calendar:</span>
          {seedAttendees.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-accent text-xs">
              {a.name}
              <button type="button" onClick={() => setSeedAttendees((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive"><X size={11} /></button>
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">— added to the extracted attendees for review</span>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        placeholder="Paste the meeting notes or transcript here — attendees, discussion, decisions, and follow-ups…"
        className="w-full rounded-md border border-input bg-background p-3 text-sm font-mono leading-relaxed resize-y"
      />

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Ber AI extracts a summary, attendees, decisions, and follow-up tasks — and pre-suggests
          which projects and opportunities the meeting touched.
        </p>
        <button
          type="button"
          onClick={analyze}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 shrink-0"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? 'Analyzing…' : 'Analyze with Ber AI'}
        </button>
      </div>
    </div>
  )
}
