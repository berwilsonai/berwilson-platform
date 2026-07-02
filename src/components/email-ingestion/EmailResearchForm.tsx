'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Search, CheckCircle2 } from 'lucide-react'

/**
 * Trigger form for an Email Research run. Fire-and-forget: it POSTs the search
 * term to /api/email-research/trigger (which kicks off the n8n workflow) and shows
 * a confirmation without waiting for the run to finish. The finished report shows
 * up later under Email Ingestion > Recent.
 */
export default function EmailResearchForm() {
  const [searchTerm, setSearchTerm] = useState('')
  const [exportLabel, setExportLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
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
      const res = await fetch('/api/email-research/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerm: searchTerm.trim(), exportLabel: exportLabel.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start the research run.')
      setStarted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the research run.')
    } finally {
      setLoading(false)
    }
  }

  if (started) {
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-medium">Started.</p>
        </div>
        <p className="text-sm text-muted-foreground">
          The report will appear under{' '}
          <Link href="/email-ingestion" className="underline font-medium text-foreground">Email Ingestion &gt; Recent</Link>{' '}
          when it&apos;s ready, usually within a few minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            setStarted(false)
            setSearchTerm('')
            setExportLabel('')
          }}
          className="inline-flex items-center h-8 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
        >
          Run another
        </button>
      </div>
    )
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
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="exportLabel" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Export label <span className="font-normal normal-case text-muted-foreground/70">(optional)</span>
        </label>
        <input
          id="exportLabel"
          type="text"
          value={exportLabel}
          onChange={(e) => setExportLabel(e.target.value)}
          placeholder="Defaults to the search term"
          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          {loading ? 'Starting…' : 'Run Email Research'}
        </button>
      </div>
    </form>
  )
}
