'use client'

import { AlertTriangle, Cpu, Clock } from 'lucide-react'
import CitationCard from './CitationCard'
import type { ChunkWithProject } from '@/types/domain'

interface Props {
  answer: string
  citations: ChunkWithProject[]
  low_confidence: boolean
  no_data: boolean
  model_used?: string
  latency_ms?: number
}

/**
 * Renders the Sonnet answer with [1], [2] citation markers replaced by
 * clickable superscript badges that scroll to their CitationCard below.
 */
function renderWithCitations(text: string): React.ReactNode[] {
  // Split on [N] or [N][M] patterns
  const parts = text.split(/(\[\d+\])/)
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/)
    if (match) {
      const num = match[1]
      return (
        <a
          key={i}
          href={`#citation-${num}`}
          onClick={(e) => {
            e.preventDefault()
            document.getElementById(`citation-${num}`)?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="inline-flex items-center justify-center w-4 h-4 rounded bg-primary/15 text-primary text-[10px] font-bold mx-0.5 align-super hover:bg-primary/25 transition-colors cursor-pointer no-underline"
          title={`Source [${num}]`}
        >
          {num}
        </a>
      )
    }
    // Render plain text — preserve line breaks and bold (**text**)
    return <span key={i}>{renderMarkdownLite(part)}</span>
  })
}

/**
 * Minimal markdown: **bold**, line breaks, and FACT/ESTIMATE/JUDGMENT signals.
 */
function renderMarkdownLite(text: string): React.ReactNode[] {
  return text.split('\n').flatMap((line, lineIdx, arr) => {
    const nodes: React.ReactNode[] = []

    // Split on **bold**
    const boldParts = line.split(/(\*\*[^*]+\*\*)/)
    boldParts.forEach((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        nodes.push(<strong key={`b-${lineIdx}-${i}`}>{part.slice(2, -2)}</strong>)
      } else if (part) {
        // Highlight FACT / ESTIMATE / JUDGMENT signal words
        const highlighted = part
          .replace(/(FACT:)/g, '|||FACT:|||')
          .replace(/(ESTIMATE:)/g, '|||ESTIMATE:|||')
          .replace(/(JUDGMENT:)/g, '|||JUDGMENT:|||')
          .replace(/(⚠ DATA GAP:?|⚠ STALE:?|⚠ LOW CONFIDENCE:?)/g, '|||$1|||')

        highlighted.split('|||').forEach((chunk, ci) => {
          if (!chunk) return
          if (/^FACT:$/.test(chunk)) {
            nodes.push(<span key={`s-${lineIdx}-${i}-${ci}`} className="text-emerald-600 font-semibold text-xs uppercase tracking-wide mr-1">FACT:</span>)
          } else if (/^ESTIMATE:$/.test(chunk)) {
            nodes.push(<span key={`s-${lineIdx}-${i}-${ci}`} className="text-amber-600 font-semibold text-xs uppercase tracking-wide mr-1">ESTIMATE:</span>)
          } else if (/^JUDGMENT:$/.test(chunk)) {
            nodes.push(<span key={`s-${lineIdx}-${i}-${ci}`} className="text-blue-600 font-semibold text-xs uppercase tracking-wide mr-1">JUDGMENT:</span>)
          } else if (/^⚠/.test(chunk)) {
            nodes.push(<span key={`s-${lineIdx}-${i}-${ci}`} className="text-amber-600 font-medium text-xs">{chunk}</span>)
          } else {
            nodes.push(<span key={`s-${lineIdx}-${i}-${ci}`}>{chunk}</span>)
          }
        })
      }
    })

    // Add line break between lines (but not after the last)
    if (lineIdx < arr.length - 1) {
      nodes.push(<br key={`br-${lineIdx}`} />)
    }

    return nodes
  })
}

export default function GroundedAnswer({ answer, citations, low_confidence, no_data, model_used, latency_ms }: Props) {
  return (
    <div className="space-y-6">
      {/* Confidence warning */}
      {low_confidence && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            The sources for this answer have low confidence scores. Treat conclusions as preliminary until verified with original documents.
          </p>
        </div>
      )}

      {/* Answer prose */}
      <div className={`text-sm leading-relaxed text-foreground ${no_data ? 'text-muted-foreground' : ''}`}>
        {no_data
          ? <p className="whitespace-pre-wrap">{answer}</p>
          : <p>{renderWithCitations(answer)}</p>
        }
      </div>

      {/* Citations */}
      {citations.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Sources ({citations.length})
          </p>
          <div className="space-y-1.5">
            {citations.map((chunk) => (
              <CitationCard key={chunk.id} chunk={chunk} />
            ))}
          </div>
        </div>
      )}

      {/* Model & latency footer */}
      {model_used && model_used !== 'n/a' && (
        <div className="flex items-center gap-4 pt-2 border-t border-border">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Cpu size={10} />
            {model_used}
          </span>
          {latency_ms != null && latency_ms > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock size={10} />
              {latency_ms < 1000
                ? `${latency_ms}ms`
                : `${(latency_ms / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
