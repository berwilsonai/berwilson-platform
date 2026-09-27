'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

import { BriefMarkdown } from '@/components/briefs/BriefMarkdown'

interface ProjectNarrativeBriefProps {
  projectId: string
  /**
   * The last brief the platform stored for this record, read server-side.
   *
   * ⚠ Until now the panel's ONLY source was `localStorage`. Every brief this
   * app generates is written to `stored_briefs` and was never read back, so
   * the panel was empty for any browser that had not personally generated it
   * — a second executive, a new laptop, a cleared cache — and it went empty
   * again the moment a regeneration failed, discarding a perfectly good brief
   * that was sitting in the database. The stored copy is the floor now;
   * regeneration can only improve on it.
   */
  initialBrief?: { content: string; createdAt: string } | null
}

export default function ProjectNarrativeBrief({ projectId, initialBrief = null }: ProjectNarrativeBriefProps) {
  const [brief, setBrief] = useState<string | null>(initialBrief?.content ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const generateBrief = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Failed (${res.status})`)
      }

      const data = await res.json() as { brief: string }
      setBrief(data.brief)

      localStorage.setItem(`bw-project-brief-${projectId}`, JSON.stringify({
        brief: data.brief,
        date: new Date().toISOString().split('T')[0],
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  // Refresh on mount, but only when what we already have is out of date.
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]

    // A brief stored today is today's brief. Nothing to do — and on this
    // stack a regeneration is 30-60s of the local model, so asking for one we
    // do not need also queues behind (and delays) every other AI job.
    if (initialBrief && initialBrief.createdAt.slice(0, 10) === today) return

    const cached = localStorage.getItem(`bw-project-brief-${projectId}`)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { brief: string; date: string }
        if (parsed.date === today) {
          setBrief(parsed.brief)
          return
        }
        // Older than today: show it while the new one is written.
        if (!initialBrief) setBrief(parsed.brief)
      } catch { /* ignore corrupt storage */ }
    }
    generateBrief()
  }, [projectId, generateBrief, initialBrief])

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.03] overflow-hidden">
      <div className="flex items-center gap-2 w-full px-4 py-3 hover:bg-primary/[0.02] transition-colors">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Sparkles size={14} className="text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground flex-1 text-left">
            Executive Brief
          </span>
        </button>
        <button
          type="button"
          onClick={() => generateBrief()}
          disabled={loading}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh brief"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse brief' : 'Expand brief'}
          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-primary/10">
          {loading && !brief && (
            <div className="space-y-2 pt-3 animate-pulse">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-3/4" />
            </div>
          )}

          {/* When there is a stored brief, a failed refresh is a footnote, not
              the content — the brief below is still the last good one. */}
          {error && (
            <p className={`text-xs pt-3 ${brief ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400'}`}>
              {brief ? `Could not refresh — showing the last brief. ${error}` : error}
            </p>
          )}

          {/* The same renderer the print view uses. Until 2026-09-26 this was
              the raw string under a `prose [&_h1]:…` wrapper, so every `#` and
              `[CRITICAL]` reached the reader as a literal character and not one
              of those child selectors could ever match. */}
          {brief && (
            <div className={`pt-3 text-foreground ${loading ? 'opacity-60' : ''}`}>
              <BriefMarkdown text={brief} suppressTitle />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
