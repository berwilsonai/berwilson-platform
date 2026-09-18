'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useStoredState } from '@/hooks/use-stored-state'
import { BriefMarkdown } from '@/components/briefs/BriefMarkdown'

/**
 * The intelligence brief panel — collapsed by default and generated only on
 * demand. The local model takes 60–90s per generation, so the morning read
 * must never block on it.
 *
 * The initial brief comes from the SERVER (latest stored portfolio brief),
 * not from localStorage. The Monday cron writes a weekly brief every week;
 * the old localStorage cache meant that brief never appeared unless this
 * browser had personally generated one, so the flagship morning read was
 * invisible on every other device. Refresh generates a fresh one in place.
 */

interface InitialBrief {
  content: string
  createdAt: string
}

export default function DailyBrief({ initial }: { initial?: InitialBrief | null }) {
  const [brief, setBrief] = useState<string | null>(initial?.content ?? null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(initial?.createdAt ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useStoredState('bw.brief.expanded', false)

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
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Failed (${res.status})`)
      }

      const data = (await res.json()) as { brief: string }
      setBrief(data.brief)
      setGeneratedAt(new Date().toISOString())
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate brief'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  // Captured once at mount — render-time Date.now() trips the compiler's
  // purity rule, and staleness does not need to tick while the page is open.
  const [mountedAt] = useState(() => Date.now())

  // The brief is written weekly (Mondays), so "old" means more than a week —
  // a Thursday reading Monday's brief is the normal case, not a stale one.
  const ageDays = generatedAt
    ? Math.floor((mountedAt - Date.parse(generatedAt)) / 86_400_000)
    : null
  const aging = ageDays !== null && ageDays > 8
  const generatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.03] elev-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 w-full px-4 py-3 hover:bg-primary/[0.02] transition-colors">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Sparkles size={14} className="text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground">Intelligence Brief</span>
          {generatedLabel && (
            <span className="text-xs text-muted-foreground truncate">{generatedLabel}</span>
          )}
        </button>
        {aging && !loading && (
          <Tooltip>
            <TooltipTrigger className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded cursor-help">
              {ageDays}d old
            </TooltipTrigger>
            <TooltipContent>
              The weekly brief normally regenerates on Mondays. This one is {ageDays} days old —
              refresh for a current read (about a minute on the local model).
            </TooltipContent>
          </Tooltip>
        )}
        {brief && (
          <button
            type="button"
            onClick={() => {
              if (!loading) generateBrief()
            }}
            disabled={loading}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
            aria-label="Refresh brief"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse brief' : 'Expand brief'}
          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-primary/10 max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
          {loading && !brief && (
            <div className="space-y-2 pt-3 animate-pulse">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-4/5" />
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400 pt-3">{error}</p>}

          {!brief && !loading && !error && (
            <div className="pt-3 flex items-center gap-3">
              <p className="text-xs text-muted-foreground flex-1">
                No stored brief yet — one is written every Monday morning, or generate one now
                (about a minute on the local model).
              </p>
              <button
                type="button"
                onClick={generateBrief}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
              >
                <Sparkles size={12} />
                Generate
              </button>
            </div>
          )}

          {brief && (
            <div
              className={`pt-3 text-sm text-foreground leading-relaxed ${loading ? 'opacity-60' : ''}`}
            >
              <BriefMarkdown text={brief} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
