'use client'

import { useState } from 'react'
import { Sparkles, Loader2, Check, X, AlertTriangle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichmentNotes {
  years_of_experience?: string | null
  past_projects?: string[] | null
  certifications?: string[] | null
  news_mentions?: string[] | null
  notable_affiliations?: string[] | null
}

interface EnrichmentPreview {
  linkedin_url: string | null
  title: string | null
  company: string | null
  full_name: string | null
  government_contract_history: string | null
  enrichment_notes: EnrichmentNotes
  sources: Array<{ url: string; title?: string }>
  graph_done: boolean
}

interface EnrichmentConflict {
  field: string
  current: string
  enriched: string
}

interface CurrentState {
  full_name: string
  title: string | null
  company: string | null
  linkedin_url: string | null
  government_contract_history: string | null
}

interface PreviewResponse {
  preview: EnrichmentPreview
  conflicts: EnrichmentConflict[]
  current: CurrentState
}

// ── Field labels ──────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full Name',
  title: 'Title',
  company: 'Company',
  linkedin_url: 'LinkedIn URL',
  government_contract_history: 'Contract History',
}

// ── Diff row component ────────────────────────────────────────────────────────

function DiffRow({
  field,
  current,
  enriched,
  isConflict,
}: {
  field: string
  current: string | null
  enriched: string | null
  isConflict: boolean
}) {
  if (!enriched) return null

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5 space-y-1',
        isConflict
          ? 'border-amber-200 bg-amber-50'
          : current
          ? 'border-border bg-muted/30'
          : 'border-emerald-200 bg-emerald-50/40'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {FIELD_LABELS[field] ?? field}
        </span>
        {isConflict && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 font-medium">
            <AlertTriangle size={10} />
            Conflict — will not overwrite
          </span>
        )}
        {!isConflict && !current && (
          <span className="text-[10px] text-emerald-700 font-medium">New</span>
        )}
      </div>

      {isConflict && (
        <p className="text-xs text-muted-foreground line-through">{current}</p>
      )}
      <p className={cn('text-sm', isConflict ? 'text-amber-800' : 'text-foreground')}>
        {field === 'linkedin_url' ? (
          <a
            href={enriched}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            {enriched} <ExternalLink size={11} />
          </a>
        ) : (
          enriched
        )}
      </p>
    </div>
  )
}

// ── Notes preview ─────────────────────────────────────────────────────────────

function NotesPreview({ notes }: { notes: EnrichmentNotes }) {
  const hasAny = Object.values(notes).some((v) => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true))
  if (!hasAny) return null

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/40 px-3 py-2.5 space-y-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Enrichment Notes
        <span className="ml-1.5 text-blue-700 font-medium normal-case">Will be saved to profile</span>
      </span>

      {notes.years_of_experience && (
        <div>
          <p className="text-[10px] text-muted-foreground">Experience</p>
          <p className="text-sm">{notes.years_of_experience}</p>
        </div>
      )}
      {notes.past_projects && notes.past_projects.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground">Past Projects</p>
          <ul className="text-sm list-disc pl-4 space-y-0.5">
            {notes.past_projects.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
      {notes.certifications && notes.certifications.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground">Certifications</p>
          <ul className="text-sm list-disc pl-4 space-y-0.5">
            {notes.certifications.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
      {notes.news_mentions && notes.news_mentions.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground">News Mentions</p>
          <ul className="text-sm list-disc pl-4 space-y-0.5">
            {notes.news_mentions.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
      {notes.notable_affiliations && notes.notable_affiliations.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground">Notable Affiliations</p>
          <ul className="text-sm list-disc pl-4 space-y-0.5">
            {notes.notable_affiliations.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface EnrichProfileButtonProps {
  partyId: string
  lastEnrichedAt?: string | null
}

type Stage = 'idle' | 'loading' | 'review' | 'saving' | 'done'

export default function EnrichProfileButton({
  partyId,
  lastEnrichedAt,
}: EnrichProfileButtonProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [data, setData] = useState<PreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setSaveConflicts] = useState<EnrichmentConflict[]>([])

  async function runEnrichment() {
    setStage('loading')
    setError(null)
    setData(null)

    try {
      const res = await fetch(`/api/parties/${partyId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Enrichment failed')
      setData(json as PreviewResponse)
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrichment failed')
      setStage('idle')
    }
  }

  async function confirmSave() {
    if (!data) return
    setStage('saving')

    try {
      const res = await fetch(`/api/parties/${partyId}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, enriched: data.preview }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setSaveConflicts(json.conflicts ?? [])
      setStage('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setStage('review')
    }
  }

  function discard() {
    setStage('idle')
    setData(null)
    setError(null)
  }

  // ── idle ──────────────────────────────────────────────────────────────────
  if (stage === 'idle') {
    return (
      <div className="space-y-2">
        <button
          onClick={runEnrichment}
          className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors"
        >
          <Sparkles size={14} className="text-purple-500" />
          Enrich Profile
        </button>
        {lastEnrichedAt && (
          <p className="text-[10px] text-muted-foreground text-center">
            Last enriched{' '}
            {new Date(lastEnrichedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (stage === 'loading') {
    return (
      <div className="rounded-md border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-purple-500" />
          <span className="text-sm font-medium">Enriching profile…</span>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Searching Microsoft Graph contacts…</p>
          <p className="text-xs text-muted-foreground">Running web research queries…</p>
          <p className="text-xs text-muted-foreground">Structuring results…</p>
        </div>
      </div>
    )
  }

  // ── review ────────────────────────────────────────────────────────────────
  if (stage === 'review' && data) {
    const { preview, conflicts, current } = data
    const conflictFields = new Set(conflicts.map((c) => c.field))

    const scalarFields: Array<keyof typeof current> = ['full_name', 'title', 'company', 'linkedin_url', 'government_contract_history']
    const hasAnyScalar = scalarFields.some(
      (f) => preview[f as keyof EnrichmentPreview] !== null
    )
    const hasNotes = Object.values(preview.enrichment_notes).some((v) => v !== null && (Array.isArray(v) ? v.length > 0 : true))
    const hasAnything = hasAnyScalar || hasNotes

    return (
      <div className="rounded-md border border-border bg-card p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-500" />
            <span className="text-sm font-semibold">Review Enrichment</span>
          </div>
          <button onClick={discard} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>

        {preview.graph_done && (
          <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
            Microsoft Graph: contact found in Outlook
          </p>
        )}

        {!hasAnything ? (
          <p className="text-sm text-muted-foreground italic">
            No new information found for this contact. Try again later or verify the email address.
          </p>
        ) : (
          <div className="space-y-2">
            {scalarFields.map((field) => {
              const enrichedVal = preview[field as keyof EnrichmentPreview] as string | null
              return (
                <DiffRow
                  key={field}
                  field={field}
                  current={current[field]}
                  enriched={enrichedVal}
                  isConflict={conflictFields.has(field)}
                />
              )
            })}
            <NotesPreview notes={preview.enrichment_notes} />
          </div>
        )}

        {/* Sources */}
        {preview.sources.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Sources
            </p>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {preview.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline truncate"
                >
                  <ExternalLink size={10} className="shrink-0" />
                  <span className="truncate">{s.title ?? s.url}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          {hasAnything && (
            <button
              onClick={confirmSave}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
            >
              <Check size={13} />
              Confirm &amp; Save
            </button>
          )}
          <button
            onClick={discard}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  // ── saving ────────────────────────────────────────────────────────────────
  if (stage === 'saving') {
    return (
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-purple-500" />
          <span className="text-sm">Saving enrichment…</span>
        </div>
      </div>
    )
  }

  // ── done ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex items-center gap-2">
        <Check size={14} className="text-emerald-600 shrink-0" />
        <span className="text-sm text-emerald-800">Profile enriched successfully</span>
      </div>
      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
          <p className="text-[10px] font-semibold text-amber-800">
            {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} logged — existing values preserved
          </p>
          {conflicts.map((c) => (
            <p key={c.field} className="text-[11px] text-amber-700">
              {FIELD_LABELS[c.field] ?? c.field}: kept &ldquo;{c.current}&rdquo;
            </p>
          ))}
        </div>
      )}
      <button
        onClick={() => { setStage('idle'); setData(null); setSaveConflicts([]) }}
        className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
      >
        <Sparkles size={12} className="text-purple-500" />
        Enrich Again
      </button>
    </div>
  )
}
