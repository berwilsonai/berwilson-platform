'use client'

import { useState } from 'react'
import { Search, ExternalLink, Save, X, Loader2, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ResearchArtifact } from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResearchResult {
  text: string
  sources: Array<{ url: string; title?: string }>
  model: string
  latencyMs: number
}

interface ResearchPanelProps {
  projectId: string
  projectName: string
  clientEntity?: string | null
  solicitationNumber?: string | null
  initialArtifacts: ResearchArtifact[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSuggestions(
  projectName: string,
  clientEntity?: string | null,
  solicitationNumber?: string | null
): string[] {
  const suggestions: string[] = []
  if (clientEntity) {
    suggestions.push(`Background and reputation of ${clientEntity}`)
    suggestions.push(`${clientEntity} government contracts history`)
    suggestions.push(`${clientEntity} construction projects news`)
  }
  if (solicitationNumber) {
    suggestions.push(`${solicitationNumber} bidders competitors`)
    suggestions.push(`${solicitationNumber} procurement history`)
  }
  suggestions.push(`${projectName} project overview market analysis`)
  suggestions.push(`Construction market conditions ${new Date().getFullYear()}`)
  return suggestions.slice(0, 5)
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Saved artifact card ───────────────────────────────────────────────────────

function ArtifactCard({ artifact }: { artifact: ResearchArtifact }) {
  const [expanded, setExpanded] = useState(false)
  const sources = (artifact.source_urls as Array<{ url: string; title?: string }> | null) ?? []

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug truncate">
            {artifact.query_text}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {formatDate(artifact.retrieved_at)}
            {sources.length > 0 && ` · ${sources.length} source${sources.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {artifact.response_text}
          </p>
          {sources.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <div className="space-y-1">
                {sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline truncate"
                  >
                    <ExternalLink size={11} className="shrink-0" />
                    <span className="truncate">{s.title ?? s.url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ResearchPanel ────────────────────────────────────────────────────────

export default function ResearchPanel({
  projectId,
  projectName,
  clientEntity,
  solicitationNumber,
  initialArtifacts,
}: ResearchPanelProps) {
  const suggestions = buildSuggestions(projectName, clientEntity, solicitationNumber)

  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResearchResult | null>(null)
  const [artifacts, setArtifacts] = useState<ResearchArtifact[]>(initialArtifacts)
  const [savedId, setSavedId] = useState<string | null>(null)

  async function runResearch() {
    if (!query.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setSavedId(null)

    try {
      const res = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), project_id: projectId }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Research failed')

      setResult(data.result)

      // Artifact is saved automatically by the API — add to list
      if (data.artifact) {
        setArtifacts((prev) => [data.artifact, ...prev])
        setSavedId(data.artifact.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research failed')
    } finally {
      setLoading(false)
    }
  }

  function useSuggestion(s: string) {
    setQuery(s)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    setQuery('')
    setResult(null)
    setError(null)
    setSavedId(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">External Research</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live web intelligence about this project's entities and market
          </p>
        </div>
        {!panelOpen && (
          <button
            onClick={() => setPanelOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            <Search size={13} />
            Run Research
          </button>
        )}
      </div>

      {/* Query suggestions */}
      {!panelOpen && suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Suggested Queries
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => useSuggestion(s)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors text-left"
              >
                <Plus size={11} />
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Query panel */}
      {panelOpen && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Research Query</h4>
            <button
              onClick={closePanel}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Suggestions as pills inside panel */}
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className={cn(
                  'h-6 px-2 rounded text-[11px] transition-colors',
                  query === s
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runResearch()
            }}
            rows={3}
            placeholder="Enter a research question about this project, entity, or market…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            autoFocus
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={runResearch}
              disabled={loading || !query.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Researching…
                </>
              ) : (
                <>
                  <Search size={14} />
                  Run Research
                </>
              )}
            </button>
            <span className="text-[10px] text-muted-foreground">⌘↵ to submit</span>
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Result
                  {savedId && (
                    <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 normal-case">
                      <Save size={10} />
                      Saved to artifacts
                    </span>
                  )}
                </p>
              </div>

              <div className="rounded-md bg-muted/40 px-4 py-3">
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {result.text}
                </p>
              </div>

              {result.sources.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Sources ({result.sources.length})
                  </p>
                  <div className="space-y-1">
                    {result.sources.map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                      >
                        <ExternalLink size={11} className="shrink-0" />
                        <span className="truncate">{s.title ?? s.url}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setResult(null)
                  setQuery('')
                  setSavedId(null)
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                + Run another query
              </button>
            </div>
          )}
        </div>
      )}

      {/* Saved artifacts */}
      {artifacts.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Saved Research ({artifacts.length})
          </p>
          <div className="space-y-2">
            {artifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>
        </div>
      )}

      {artifacts.length === 0 && !panelOpen && (
        <p className="text-sm text-muted-foreground italic">
          No research artifacts yet. Run a query to get started.
        </p>
      )}
    </div>
  )
}
