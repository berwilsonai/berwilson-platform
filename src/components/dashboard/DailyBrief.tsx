'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

export default function DailyBrief() {
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [stale, setStale] = useState(false)

  // Load cached brief on mount
  useEffect(() => {
    const cached = localStorage.getItem('bw-daily-brief')
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { brief: string; date: string }
        const today = new Date().toISOString().split('T')[0]
        if (parsed.date === today) {
          setBrief(parsed.brief)
          return
        }
        // Show stale brief while loading fresh one
        setBrief(parsed.brief)
        setStale(true)
      } catch { /* ignore */ }
    }
    generateBrief()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generateBrief = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (res.status === 404) {
          // No active projects
          setBrief(null)
          return
        }
        throw new Error(data.error ?? `Failed (${res.status})`)
      }

      const data = await res.json() as { brief: string }
      setBrief(data.brief)
      setStale(false)

      // Cache with today's date
      localStorage.setItem('bw-daily-brief', JSON.stringify({
        brief: data.brief,
        date: new Date().toISOString().split('T')[0],
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setLoading(false)
    }
  }, [])

  if (!brief && !loading && !error) return null

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.03] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 hover:bg-primary/[0.02] transition-colors"
      >
        <Sparkles size={14} className="text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1 text-left">
          Daily Intelligence Brief
        </span>
        {stale && !loading && (
          <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            Yesterday
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); generateBrief() }}
          disabled={loading}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh brief"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-primary/10 max-h-52 overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
          {loading && !brief && (
            <div className="space-y-2 pt-3 animate-pulse">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-4/5" />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 pt-3">{error}</p>
          )}

          {brief && (
            <div className={`pt-3 text-sm text-foreground leading-relaxed prose prose-sm prose-slate max-w-none [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground whitespace-pre-wrap ${loading ? 'opacity-60' : ''}`}>
              {brief}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
