'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search } from 'lucide-react'

/**
 * Email Research runner. POSTs to /api/email-research/run, which searches the
 * connected Outlook mailbox, reads matching threads + attachments, and stages
 * a pending review session. On success we land directly on the review screen.
 * The run is synchronous and can take a few minutes — keep the tab open.
 */

const TIME_RANGES = [
  { label: 'Last 90 days', value: 90 },
  { label: 'Last year', value: 365 },
  { label: 'All time', value: 3650 },
] as const

export default function EmailResearchForm() {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState('')
  const [label, setLabel] = useState('')
  const [sinceDays, setSinceDays] = useState<number>(365)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!searchTerm.trim()) {
      setError('Enter a search term first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/email-research/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerm: searchTerm.trim(), label: label.trim(), sinceDays }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The research run failed.')
      router.push(`/email-ingestion/${data.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The research run failed.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="searchTerm" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Search term (person, email, or project keyword)
        </label>
        <input
          id="searchTerm"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="e.g. Jane Doe, jane@acme.com, or Fort Bliss barracks"
          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
          disabled={loading}
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="label" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Label <span className="font-normal normal-case text-muted-foreground/70">(optional)</span>
          </label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Defaults to the search term"
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sinceDays" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Time range
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

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      {loading && (
        <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/50 px-3 py-2.5">
          <Loader2 size={15} className="animate-spin mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Searching Outlook and reading threads and attachments — this takes 1–4 minutes.
            Keep this tab open; you&apos;ll land on the review screen when it&apos;s done.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          {loading ? 'Researching…' : 'Run Email Research'}
        </button>
      </div>
    </form>
  )
}
