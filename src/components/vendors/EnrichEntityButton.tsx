'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Sparkles, Tag } from 'lucide-react'

interface EnrichEntityButtonProps {
  entityId: string
  entityName: string
  websiteUrl: string | null
  enrichedAt: string | null
}

type State = 'idle' | 'loading' | 'review' | 'saving' | 'done'

interface EnrichmentPreview {
  description: string | null
  specialties: string[] | null
  headquarters: string | null
  website_url: string | null
  enrichment_notes: Record<string, unknown>
  sources: Array<{ url: string; title?: string }>
}

export default function EnrichEntityButton({
  entityId,
  entityName,
  enrichedAt,
}: EnrichEntityButtonProps) {
  const [state, setState] = useState<State>('idle')
  const [preview, setPreview] = useState<EnrichmentPreview | null>(null)
  const [conflicts, setConflicts] = useState<Array<{ field: string; current: string; enriched: string }>>([])
  const [error, setError] = useState('')

  const handleEnrich = async () => {
    setState('loading')
    setError('')

    try {
      const res = await fetch(`/api/entities/${entityId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Enrichment failed')
        setState('idle')
        return
      }

      const data = await res.json()
      setPreview(data.preview)
      setConflicts(data.conflicts ?? [])
      setState('review')
    } catch {
      setError('Network error')
      setState('idle')
    }
  }

  const handleConfirm = async () => {
    if (!preview) return
    setState('saving')

    try {
      const res = await fetch(`/api/entities/${entityId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, enriched: preview }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Save failed')
        setState('review')
        return
      }

      setState('done')
      // Reload after a short delay to show updated data
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      setError('Network error')
      setState('review')
    }
  }

  if (state === 'done') {
    return (
      <div className="flex items-center gap-2 h-8 px-3 rounded-md bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/60 text-green-700 dark:text-green-300 text-xs w-full justify-center">
        <CheckCircle2 size={12} />
        Enriched! Reloading…
      </div>
    )
  }

  if ((state === 'review' || state === 'saving') && preview) {
    return (
      <div className="rounded-lg border border-border p-3 space-y-3 bg-muted/30">
        <h4 className="text-xs font-semibold">Research Results for {entityName}</h4>

        {preview.description && (
          <div>
            <p className="text-xs text-muted-foreground font-medium">Description</p>
            <p className="text-xs">{preview.description}</p>
          </div>
        )}

        {preview.specialties && preview.specialties.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground font-medium">Specialties</p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {preview.specialties.map(s => (
                <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">
                  <Tag size={8} />
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {preview.headquarters && (
          <div>
            <p className="text-xs text-muted-foreground font-medium">Headquarters</p>
            <p className="text-xs">{preview.headquarters}</p>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-2">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Conflicts (won&apos;t overwrite):</p>
            {conflicts.map(c => (
              <p key={c.field} className="text-xs text-amber-700 dark:text-amber-300">
                {c.field}: &quot;{c.current}&quot; → &quot;{c.enriched}&quot;
              </p>
            ))}
          </div>
        )}

        {preview.sources.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground font-medium">Sources ({preview.sources.length})</p>
            <div className="max-h-20 overflow-y-auto space-y-0.5 mt-0.5">
              {preview.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-primary hover:underline truncate"
                >
                  {s.title || s.url}
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={state === 'saving'}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {state === 'saving' ? 'Saving…' : 'Confirm & Save'}
          </button>
          <button
            onClick={() => { setState('idle'); setPreview(null) }}
            className="h-7 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={handleEnrich}
        disabled={state === 'loading'}
        className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors w-full disabled:opacity-50"
      >
        {state === 'loading' ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Researching…
          </>
        ) : (
          <>
            <Sparkles size={12} />
            AI Research
          </>
        )}
      </button>
      {enrichedAt && state === 'idle' && (
        <p className="text-xs text-muted-foreground text-center mt-1">
          Last enriched {new Date(enrichedAt).toLocaleDateString()}
        </p>
      )}
      {error && state === 'idle' && (
        <p className="text-xs text-destructive text-center mt-1">{error}</p>
      )}
    </div>
  )
}
