'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserSearch } from 'lucide-react'

/**
 * People Intake runner. POSTs to /api/contacts/profile-intake/run, which reads
 * the stored mail for everyone named and stages a pending review session.
 *
 * The run is synchronous and can take a few minutes — one model pass per
 * person — but the server finishes on its own, so navigating away only skips
 * the redirect; the draft still lands under Recent for review.
 */

const TIME_RANGES = [
  { label: 'All time', value: 3650 },
  { label: 'Last year', value: 365 },
  { label: 'Last 90 days', value: 90 },
] as const

const PLACEHOLDER = `Seth Lloyd (Owner of tech advisory firm)
Trevor Burton (tech advisory executive)
jerren@example.com (land owner)`

export default function ProfileIntakeForm() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [label, setLabel] = useState('')
  const [sinceDays, setSinceDays] = useState<number>(3650)
  const [skipWeb, setSkipWeb] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Rough count so the wait is predictable before committing to it.
  const estimated = input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean).length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) {
      setError('Enter at least one name or email address.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/contacts/profile-intake/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim(), label: label.trim(), sinceDays, skipWeb }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The profile run failed.')
      router.push(`/intake/people/${data.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The profile run failed.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="people" className="label-caps text-muted-foreground">
          Who to profile — one per line
        </label>
        <textarea
          id="people"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={5}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-mono resize-y"
          disabled={loading}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          An email address is the most reliable. A full name works; a first name alone will not, and
          the run says so rather than guessing. Anything in parentheses is read as a role hint. You
          can paste a To: or Cc: line straight out of an email.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="label" className="label-caps text-muted-foreground">
            Label <span className="font-normal normal-case text-muted-foreground/70">(optional)</span>
          </label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Eagle Mountain cast"
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sinceDays" className="label-caps text-muted-foreground">
            Mail to read
          </label>
          <select
            id="sinceDays"
            value={sinceDays}
            onChange={(e) => setSinceDays(Number(e.target.value))}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            disabled={loading}
          >
            {TIME_RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer select-none relative">
        <span className="absolute -inset-3" aria-hidden />
        <input
          type="checkbox"
          checked={skipWeb}
          onChange={(e) => setSkipWeb(e.target.checked)}
          disabled={loading}
          className="mt-0.5 size-4 rounded border-input"
        />
        <span className="text-sm text-muted-foreground">
          Mail only — skip the web search.{' '}
          <span className="text-muted-foreground/70">
            Faster, and the right choice for people at private firms, who have no web footprint to find.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      {loading && (
        <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/50 px-3 py-2.5">
          <Loader2 size={15} className="animate-spin mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Reading the mail and profiling {estimated || 1} {estimated === 1 ? 'person' : 'people'} —
            about a minute each. Stay here to land on the review screen, or navigate away; the draft
            shows under Recent below and will be waiting.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {estimated > 0 && `${estimated} ${estimated === 1 ? 'person' : 'people'} · roughly ${estimated} min`}
        </span>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <UserSearch size={15} />}
          {loading ? 'Profiling…' : 'Profile these people'}
        </button>
      </div>
    </form>
  )
}
