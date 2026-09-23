'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Bug, ArrowRight, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DEV_NOTE_KINDS,
  DEV_NOTE_KIND_LABELS,
  type DevNoteKind,
} from '@/lib/utils/dev-notes'

/**
 * The report dialog, mounted once in the app shell and opened from anywhere via
 * a window `open-dev-note` event — the same pattern the quick-upload sheet
 * uses. Both entry points (the sidebar footer button on desktop, the More grid
 * on mobile) dispatch that event rather than navigating.
 *
 * ⚠ IT OPENS IN PLACE, AND THAT IS THE WHOLE DESIGN. A bug report is worth
 * roughly what its context is worth, and the reporter is usually the one person
 * who cannot say precisely which screen they were on. Navigating to a form
 * first would throw away the one fact worth capturing automatically, so the
 * dialog reads `usePathname()` and the user agent and sends them along.
 */
export default function DevNoteDock() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<DevNoteKind>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  // Captured when the dialog OPENS, not when it submits — a reporter who
  // navigates mid-write would otherwise file the page they ended on.
  const [context, setContext] = useState('')

  useEffect(() => {
    function onOpenEvent() {
      setContext(window.location.pathname + window.location.search)
      setOpen(true)
    }
    window.addEventListener('open-dev-note', onOpenEvent)
    return () => window.removeEventListener('open-dev-note', onOpenEvent)
  }, [])

  function reset() {
    setKind('bug')
    setTitle('')
    setBody('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/dev-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          body: body.trim() || null,
          page_path: context || pathname,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not send the report')
      toast.success('Thanks — your report was logged.', {
        description: 'It shows up in Developer Notes and gets checked off when it is handled.',
      })
      reset()
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the report')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug size={16} className="text-primary" />
            Report to the developer
          </DialogTitle>
          <DialogDescription>
            Something broken, missing, or worth changing. It becomes a tracked item that gets
            checked off.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {/* Kind — segmented, because four options in a dropdown is a click
              spent on a choice the reporter already knows. */}
          <div className="flex flex-wrap gap-1.5">
            {DEV_NOTE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-11 sm:h-8 px-3 rounded-md text-xs font-medium ring-1 ring-inset transition-colors ${
                  kind === k
                    ? 'bg-primary text-primary-foreground ring-primary'
                    : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground'
                }`}
              >
                {DEV_NOTE_KIND_LABELS[k]}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="dev-note-title" className="label-caps text-muted-foreground">
              What happened
            </label>
            <input
              id="dev-note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={300}
              placeholder={
                kind === 'bug'
                  ? 'e.g. The task due date saves a day early'
                  : 'e.g. Let me filter tasks by project on mobile'
              }
              className="mt-1 w-full h-11 sm:h-9 px-2.5 rounded-md border border-border bg-background text-base sm:text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div>
            <label htmlFor="dev-note-body" className="label-caps text-muted-foreground">
              Detail <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="dev-note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={8000}
              placeholder={
                kind === 'bug'
                  ? 'What you were doing, what you expected, what happened instead.'
                  : 'Why it would help, and what it would let you do.'
              }
              className="mt-1 w-full px-2.5 py-2 rounded-md border border-border bg-background text-base sm:text-sm outline-none focus:ring-2 focus:ring-ring/40 resize-y"
            />
          </div>

          {/* State what is being sent. A reporter should never be surprised by
              what a feedback form attached on their behalf. */}
          <p className="text-xs text-muted-foreground">
            Sent with this report: the page you were on
            {context ? <span className="font-mono"> ({context})</span> : null}, your browser, and
            your name.
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Link
              href="/dev-notes"
              onClick={() => setOpen(false)}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              See all reports <ArrowRight size={12} />
            </Link>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!title.trim() || saving}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Sending…' : 'Send report'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
