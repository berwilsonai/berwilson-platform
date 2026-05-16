'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Sparkles, Calendar, FileText, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Brief {
  id: string
  brief_type: string
  title: string
  content: string
  metadata: Record<string, unknown> | null
  model_used: string | null
  latency_ms: number | null
  created_at: string
  project_name: string | null
}

const TYPE_ICONS: Record<string, typeof Sparkles> = {
  portfolio: Sparkles,
  project: FileText,
  meeting_prep: Calendar,
}

const TYPE_LABELS: Record<string, string> = {
  portfolio: 'Daily Brief',
  project: 'Project Brief',
  meeting_prep: 'Meeting Prep',
}

export default function BriefsList({ briefs }: { briefs: Brief[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(briefs[0]?.id ?? null)
  const [generating, setGenerating] = useState(false)

  const generateNow = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        // Reload to show new brief
        window.location.reload()
      }
    } catch { /* ignore */ } finally {
      setGenerating(false)
    }
  }

  if (briefs.length === 0) {
    return (
      <div className="text-center py-16">
        <Sparkles size={40} className="mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-sm font-medium text-foreground">No briefs generated yet</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Briefs are generated daily by the cron job, or you can generate one now
        </p>
        <button
          onClick={generateNow}
          disabled={generating}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
          Generate Portfolio Brief
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Generate button */}
      <div className="flex justify-end">
        <button
          onClick={generateNow}
          disabled={generating}
          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
          Generate Now
        </button>
      </div>

      {briefs.map((brief) => {
        const expanded = expandedId === brief.id
        const Icon = TYPE_ICONS[brief.brief_type] ?? Sparkles
        const dateStr = new Date(brief.created_at).toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit',
        })

        return (
          <div key={brief.id} className="rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setExpandedId(expanded ? null : brief.id)}
              className="flex items-center gap-3 w-full px-4 py-3 hover:bg-muted/30 transition-colors text-left"
            >
              <Icon size={14} className="text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{brief.title}</p>
                <p className="text-xs text-muted-foreground">
                  {dateStr}
                  {brief.project_name && ` · ${brief.project_name}`}
                  <span className="ml-2 opacity-60">{TYPE_LABELS[brief.brief_type] ?? brief.brief_type}</span>
                </p>
              </div>
              {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </button>

            {expanded && (
              <div className="px-4 pb-4 border-t border-border">
                <div className="pt-3 text-sm text-foreground leading-relaxed prose prose-sm prose-slate max-w-none [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground whitespace-pre-wrap">
                  {brief.content}
                </div>
                {brief.model_used && (
                  <p className="text-xs text-muted-foreground mt-3 pt-2 border-t border-border/50">
                    {brief.model_used} · {brief.latency_ms ? `${(brief.latency_ms / 1000).toFixed(1)}s` : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
