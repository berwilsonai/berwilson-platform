'use client'

import { useState } from 'react'
import { Sparkles, Loader2, Check, X, AlertTriangle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichmentNotes {
  years_of_experience?: string | null
  past_projects?: string[] | null
  certifications?: string[] | null
  personal_credentials?: string[] | null
  litigation_history?: string[] | null
  news_mentions?: string[] | null
  notable_affiliations?: string[] | null
  address?: string | null
}

interface EnrichmentPreview {
  linkedin_url: string | null
  title: string | null
  company: string | null
  full_name: string | null
  phone: string | null
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
  phone: string | null
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
  phone: 'Phone',
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
          ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40'
          : current
          ? 'border-border bg-muted/30'
          : 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/40'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="label-caps text-muted-foreground">
          {FIELD_LABELS[field] ?? field}
        </span>
        {isConflict && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300 font-medium">
            <AlertTriangle size={10} />
            Conflict — will not overwrite
          </span>
        )}
        {!isConflict && !current && (
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">New</span>
        )}
      </div>

      {isConflict && (
        <p className="text-xs text-muted-foreground line-through">{current}</p>
      )}
      <p className={cn('text-sm', isConflict ? 'text-amber-800 dark:text-amber-300' : 'text-foreground')}>
        {field === 'linkedin_url' ? (
          <a
            href={enriched}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
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

  const arrayFields: Array<{ key: keyof EnrichmentNotes; label: string }> = [
    { key: 'past_projects', label: 'Past Projects' },
    { key: 'certifications', label: 'Certifications' },
    { key: 'personal_credentials', label: 'Licenses & Credentials' },
    { key: 'litigation_history', label: 'Litigation History' },
    { key: 'news_mentions', label: 'News Mentions' },
    { key: 'notable_affiliations', label: 'Notable Affiliations' },
  ]

  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-950/40 px-3 py-2.5 space-y-2">
      <span className="label-caps text-muted-foreground">
        Enrichment Notes
        <span className="ml-1.5 text-blue-700 dark:text-blue-300 font-medium normal-case">Will be saved to profile</span>
      </span>

      {notes.years_of_experience && (
        <div>
          <p className="text-xs text-muted-foreground">Experience</p>
          <p className="text-sm">{notes.years_of_experience}</p>
        </div>
      )}
      {notes.address && (
        <div>
          <p className="text-xs text-muted-foreground">Address</p>
          <p className="text-sm">{notes.address}</p>
        </div>
      )}
      {arrayFields.map(({ key, label }) => {
        const arr = notes[key]
        if (!Array.isArray(arr) || arr.length === 0) return null
        return (
          <div key={key}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <ul className="text-sm list-disc pl-4 space-y-0.5">
              {(arr as string[]).map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        )
      })}
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
          <Sparkles size={14} className="text-purple-500 dark:text-purple-400" />
          Enrich Profile
        </button>
        {lastEnrichedAt && (
          <p className="text-xs text-muted-foreground text-center">
            Last enriched{' '}
            {new Date(lastEnrichedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (stage === 'loading') {
    return (
      <div className="rounded-md border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-purple-500 dark:text-purple-400" />
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

    const scalarFields: Array<keyof typeof current> = ['full_name', 'title', 'company', 'phone', 'linkedin_url', 'government_contract_history']
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
            <Sparkles size={14} className="text-purple-500 dark:text-purple-400" />
            <span className="text-sm font-semibold">Review Enrichment</span>
          </div>
          <button onClick={discard} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>

        {preview.graph_done && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded px-2 py-1">
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
            <p className="label-caps text-muted-foreground">
              Sources
            </p>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {preview.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline truncate"
                >
                  <ExternalLink size={10} className="shrink-0" />
                  <span className="truncate">{s.title ?? s.url}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

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
          <Loader2 size={14} className="animate-spin text-purple-500 dark:text-purple-400" />
          <span className="text-sm">Saving enrichment…</span>
        </div>
      </div>
    )
  }

  // ── done ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5 flex items-center gap-2">
        <Check size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-sm text-emerald-800 dark:text-emerald-300">Profile enriched successfully</span>
      </div>
      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} logged — existing values preserved
          </p>
          {conflicts.map((c) => (
            <p key={c.field} className="text-xs text-amber-700 dark:text-amber-300">
              {FIELD_LABELS[c.field] ?? c.field}: kept &ldquo;{c.current}&rdquo;
            </p>
          ))}
        </div>
      )}
      <button
        onClick={() => { setStage('idle'); setData(null); setSaveConflicts([]) }}
        className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
      >
        <Sparkles size={12} className="text-purple-500 dark:text-purple-400" />
        Enrich Again
      </button>
    </div>
  )
}
