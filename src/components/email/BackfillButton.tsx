'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface BackfillResult {
  total: number
  processed: number
  skipped: number
  failed: number
  weeks: number
}

export default function BackfillButton() {
  const [weeks, setWeeks] = useState('2')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runBackfill() {
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const body: Record<string, number> = { weeks: parseInt(weeks, 10) }
      if (weeks === 'test25') {
        body.weeks = 4
        body.limit = 25
      }
      const res = await fetch('/api/email/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Backfill failed')
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 items-end">
      <div className="flex items-center gap-2">
        <select
          value={weeks}
          onChange={(e) => setWeeks(e.target.value)}
          disabled={loading}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="test25">Test: last 25 emails</option>
          <option value="1">Last 1 week</option>
          <option value="2">Last 2 weeks</option>
          <option value="4">Last 4 weeks</option>
          <option value="8">Last 8 weeks</option>
        </select>
        <button
          onClick={runBackfill}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Running…' : 'Backfill Inbox'}
        </button>
      </div>
      {result && (
        <p className="text-xs text-muted-foreground">
          Done — {result.total} emails scanned: {result.processed} new, {result.skipped} skipped,{' '}
          {result.failed > 0 && <span className="text-destructive">{result.failed} failed</span>}
          {result.failed === 0 && '0 failed'}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
