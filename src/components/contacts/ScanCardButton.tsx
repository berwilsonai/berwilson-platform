'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Check, X, ExternalLink, AlertTriangle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// The draft shape returned by /api/contacts/scan-card (see lib/contacts/card-intake).
interface CardScanDraft {
  full_name: string | null
  title: string | null
  company: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  company_summary: string | null
  fit_notes: string | null
  tags: string[]
  raw_text: string
  sources: Array<{ url: string; title?: string }>
  researched: boolean
  research_error: string | null
}

type Stage = 'idle' | 'scanning' | 'review' | 'saving'

type TextField = 'full_name' | 'title' | 'company' | 'email' | 'phone' | 'website' | 'address'

const FIELDS: Array<{ key: TextField; label: string; type?: string; wide?: boolean }> = [
  { key: 'full_name', label: 'Name' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'website', label: 'Website' },
  { key: 'address', label: 'Address', wide: true },
]

const inputClass =
  'w-full h-11 sm:h-9 px-2.5 rounded-md border border-input bg-background text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring'

export default function ScanCardButton() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [draft, setDraft] = useState<CardScanDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof CardScanDraft>(key: K, value: CardScanDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset immediately so re-picking the same photo still fires a change event.
    e.target.value = ''
    if (!file) return

    setStage('scanning')
    setError(null)
    setDraft(null)

    try {
      const body = new FormData()
      body.append('image', file)
      const res = await fetch('/api/contacts/scan-card', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not read the card.')
      setDraft(json.draft as CardScanDraft)
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the card.')
      setStage('idle')
    }
  }

  async function save() {
    if (!draft) return
    setStage('saving')
    setError(null)
    try {
      const res = await fetch('/api/contacts/scan-card/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save the contact.')
      router.push(`/contacts/${json.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the contact.')
      setStage('review')
    }
  }

  function discard() {
    setStage('idle')
    setDraft(null)
    setError(null)
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        // On a phone this opens the camera directly, which is the whole point.
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={stage === 'scanning'}
        className="inline-flex items-center gap-1.5 h-11 sm:h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors shrink-0 disabled:opacity-60"
      >
        {stage === 'scanning' ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
        <span className="whitespace-nowrap">Scan Card</span>
      </button>

      {error && stage === 'idle' && (
        <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* A dialog rather than an inline panel: the review is the whole task once
          you have taken the photo, and on a phone it wants the screen. */}
      <Dialog open={stage !== 'idle'} onOpenChange={(open) => { if (!open && stage !== 'saving') discard() }}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-2xl max-h-[88vh] overflow-y-auto"
        >
          {!draft ? (
            <ScanningPanel />
          ) : (
            <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles size={14} className="text-purple-500 dark:text-purple-400" />
              Review contact from card
            </DialogTitle>
            <button onClick={discard} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>

          {!draft.researched && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded px-2 py-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                Built from the card alone — no web research{draft.research_error ? `: ${draft.research_error}` : '.'}
              </span>
            </p>
          )}

          {/* Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {FIELDS.map(({ key, label, type, wide }) => (
              <label key={key} className={cn('space-y-1', wide && 'sm:col-span-2')}>
                <span className="label-caps text-muted-foreground">{label}</span>
                <input
                  type={type ?? 'text'}
                  value={draft[key] ?? ''}
                  onChange={(e) => set(key, e.target.value || null)}
                  className={inputClass}
                />
              </label>
            ))}
          </div>

          {/* What they do / where they fit */}
          <label className="block space-y-1">
            <span className="label-caps text-muted-foreground">What they do</span>
            <textarea
              rows={3}
              value={draft.company_summary ?? ''}
              onChange={(e) => set('company_summary', e.target.value || null)}
              placeholder="Nothing found — add a line yourself"
              className="w-full px-2.5 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block space-y-1">
            <span className="label-caps text-muted-foreground">Possible fit for Ber Wilson</span>
            <textarea
              rows={3}
              value={draft.fit_notes ?? ''}
              onChange={(e) => set('fit_notes', e.target.value || null)}
              className="w-full px-2.5 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {draft.tags.length > 0 && (
            <div className="space-y-1">
              <span className="label-caps text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {draft.tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set('tags', draft.tags.filter((x) => x !== t))}
                    title="Remove tag"
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-muted/30 text-xs hover:bg-accent transition-colors"
                  >
                    {t}
                    <X size={10} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {draft.sources.length > 0 && (
            <details className="space-y-1">
              <summary className="label-caps text-muted-foreground cursor-pointer">
                Sources ({draft.sources.length})
              </summary>
              <div className="space-y-0.5 max-h-28 overflow-y-auto pt-1">
                {draft.sources.map((s, i) => (
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
            </details>
          )}

          <details className="space-y-1">
            <summary className="label-caps text-muted-foreground cursor-pointer">Text read from the card</summary>
            <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap rounded-md bg-muted/30 p-2 max-h-40 overflow-y-auto">
              {draft.raw_text}
            </pre>
          </details>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={stage === 'saving' || !(draft.full_name || draft.company)}
              className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {stage === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save contact
            </button>
            <button
              onClick={discard}
              disabled={stage === 'saving'}
              className="inline-flex items-center h-11 sm:h-9 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors"
            >
              Discard
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            The photo was read on this machine and already discarded — only the text above is kept.
          </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ScanningPanel() {
  return (
    <div className="space-y-2">
      <DialogTitle className="flex items-center gap-2 text-sm font-medium">
        <Loader2 size={14} className="animate-spin text-purple-500 dark:text-purple-400" />
        Reading the card…
      </DialogTitle>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Recognizing text on this machine…</p>
        <p>Researching the company…</p>
        <p>Assessing fit for Ber Wilson…</p>
      </div>
      <p className="text-xs text-muted-foreground">This takes up to a minute or two.</p>
    </div>
  )
}
