'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Building2, Calendar } from 'lucide-react'
import type { ChunkWithProject } from '@/types/domain'

interface Props {
  chunk: ChunkWithProject
}

export default function CitationCard({ chunk }: Props) {
  const [expanded, setExpanded] = useState(false)

  const date = new Date(chunk.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const confidencePct = Math.round(chunk.source_confidence * 100)
  const confidenceColor =
    chunk.source_confidence >= 0.8
      ? 'text-emerald-600'
      : chunk.source_confidence >= 0.5
        ? 'text-amber-600'
        : 'text-red-500'

  // Show a short preview (first 120 chars)
  const preview = chunk.content.slice(0, 120).trim() + (chunk.content.length > 120 ? '…' : '')

  return (
    <div
      id={`citation-${chunk.citation_index}`}
      className="border border-border rounded-lg bg-card overflow-hidden"
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        {/* Citation number badge */}
        <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-primary/10 text-primary text-[11px] font-bold mt-0.5">
          {chunk.citation_index}
        </span>

        <div className="flex-1 min-w-0">
          {/* Project + date */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
              <Building2 size={10} className="text-muted-foreground" />
              {chunk.project_name}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar size={10} />
              {date}
            </span>
            <span className={`text-[11px] font-medium ${confidenceColor}`}>
              {confidencePct}% confidence
            </span>
          </div>
          {/* Preview text */}
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {preview}
          </p>
        </div>

        {expanded ? (
          <ChevronUp size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {/* Full content */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border">
          <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-sans mt-2">
            {chunk.content}
          </pre>
        </div>
      )}
    </div>
  )
}
