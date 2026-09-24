'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, Loader2,
  RefreshCw, UserCheck, UserPlus, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The whole stack, reviewed on one screen.
 *
 * Every row opens on its verdict, not its form fields: the reader is deciding
 * whether this person is worth filing, and the answer to that is the fit read,
 * not the phone number. The fields are one click away for the card the model
 * misread.
 *
 * A row the directory already holds defaults to filling that contact in rather
 * than creating a second one; a row where two contacts fit equally well
 * defaults to skip and asks, because guessing there is how one person becomes
 * two records nobody notices for months.
 */

interface PartyCandidate {
  id: string
  full_name: string
  company: string | null
  email: string | null
}

export interface CardDraft {
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
  existing_party_id: string | null
  existing_party_name: string | null
  match_type: 'exact_email' | 'exact_name' | 'fuzzy_name' | 'none'
  ambiguous: boolean
  candidates: PartyCandidate[]
}

export interface CardBatchItem {
  ref: string
  file_name: string | null
  raw_text: string
  state: 'queued' | 'reading' | 'ready' | 'failed'
  draft: CardDraft | null
  error: string | null
}

type Action = 'create' | 'link' | 'skip'

interface Row extends CardDraft {
  ref: string
  file_name: string | null
  action: Action
  link_target: string | null
}

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

const MATCH_LABEL: Record<CardDraft['match_type'], string> = {
  exact_email: 'same email address',
  exact_name: 'same name',
  fuzzy_name: 'a close name',
  none: '',
}

function initialRows(items: CardBatchItem[]): Row[] {
  return items
    .filter((i) => i.state === 'ready' && i.draft)
    .map((i) => {
      const d = i.draft!
      return {
        ...d,
        ref: i.ref,
        file_name: i.file_name,
        // Ambiguity is the one case that must refuse to choose for you.
        action: d.ambiguous ? 'skip' : d.existing_party_id ? 'link' : 'create',
        link_target: d.existing_party_id,
      }
    })
}

export default function CardBatchReview({
  sessionId,
  items,
  running,
}: {
  sessionId: string
  items: CardBatchItem[]
  running: boolean
}) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() => initialRows(items))
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failures, setFailures] = useState<Array<{ ref: string; name: string | null; error: string }>>([])

  const unfinished = items.filter((i) => i.state !== 'ready')
  const selected = useMemo(() => rows.filter((r) => r.action !== 'skip'), [rows])

  function set<K extends keyof Row>(ref: string, key: K, value: Row[K]) {
    setRows((prev) => prev.map((r) => (r.ref === ref ? { ...r, [key]: value } : r)))
  }

  async function save() {
    if (selected.length === 0) return
    setSaving(true)
    setError(null)
    setFailures([])
    try {
      const res = await fetch('/api/contacts/scan-card/batch/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          cards: selected.map((r) => ({
            ref: r.ref,
            action: r.action,
            existing_party_id: r.action === 'link' ? r.link_target : null,
            full_name: r.full_name,
            title: r.title,
            company: r.company,
            email: r.email,
            phone: r.phone,
            website: r.website,
            address: r.address,
            company_summary: r.company_summary,
            fit_notes: r.fit_notes,
            tags: r.tags,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save the contacts.')
      if (Array.isArray(json.failures) && json.failures.length > 0) {
        setFailures(json.failures)
        setSaving(false)
        router.refresh()
        return
      }
      router.push('/contacts')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the contacts.')
      setSaving(false)
    }
  }

  async function resume() {
    setResuming(true)
    setError(null)
    try {
      const res = await fetch('/api/contacts/scan-card/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not restart the unread cards.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restart the unread cards.')
    } finally {
      setResuming(false)
    }
  }

  return (
    <div className="space-y-4">
      {unfinished.length > 0 && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <p className="text-sm text-muted-foreground">
            {running ? (
              <>
                {unfinished.length} card{unfinished.length === 1 ? '' : 's'} still being researched —
                about a minute and a half each. Everything below is ready now; this page refreshes
                itself.
              </>
            ) : (
              <>
                {unfinished.length} card{unfinished.length === 1 ? '' : 's'} never finished. The text
                read off {unfinished.length === 1 ? 'it' : 'them'} is still here, so there is no need
                to re-photograph anything.
              </>
            )}
          </p>
          {!running && (
            <button
              type="button"
              onClick={resume}
              disabled={resuming}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors shrink-0 disabled:opacity-60"
            >
              {resuming ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Finish them
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {running ? 'Nothing is ready yet — the first card is still being read.' : 'No cards in this batch could be read.'}
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {rows.map((row) => {
            const isOpen = open[row.ref] ?? false
            const heading = row.full_name || row.company || row.file_name || 'Unreadable card'
            const subtitle = [row.title, row.company].filter(Boolean).join(' · ')
            const failure = failures.find((f) => f.ref === row.ref)

            return (
              <div key={row.ref} className={cn('px-3 sm:px-4 py-3', row.action === 'skip' && 'opacity-60')}>
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [row.ref]: !isOpen }))}
                    className="relative mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={isOpen ? 'Hide details' : 'Show details'}
                  >
                    <span className="absolute -inset-3" aria-hidden />
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium">{heading}</span>
                      {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
                    </div>

                    {row.fit_notes && (
                      <p className={cn('text-xs text-muted-foreground', !isOpen && 'line-clamp-2')}>
                        {row.fit_notes}
                      </p>
                    )}

                    {row.ambiguous && (
                      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        <span>
                          {row.candidates.length} contacts fit this card equally well. Pick one to
                          fill in, or create a new contact.
                        </span>
                      </p>
                    )}

                    {!row.ambiguous && row.existing_party_name && (
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <UserCheck size={12} className="shrink-0 mt-0.5" />
                        <span>
                          Already in the directory as{' '}
                          <Link
                            href={`/contacts/${row.existing_party_id}`}
                            target="_blank"
                            className="text-primary hover:underline"
                          >
                            {row.existing_party_name}
                          </Link>{' '}
                          ({MATCH_LABEL[row.match_type]}).
                        </span>
                      </p>
                    )}

                    {!row.researched && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Built from the card alone — no web research
                        {row.research_error ? `: ${row.research_error}` : '.'}
                      </p>
                    )}

                    {failure && (
                      <p className="text-xs text-destructive">Not saved — {failure.error}</p>
                    )}
                  </div>

                  <ActionPicker row={row} onChange={(a) => set(row.ref, 'action', a)} />
                </div>

                {isOpen && (
                  <div className="mt-3 pl-0 sm:pl-6 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {FIELDS.map(({ key, label, type, wide }) => (
                        <label key={key} className={cn('space-y-1', wide && 'sm:col-span-2')}>
                          <span className="label-caps text-muted-foreground">{label}</span>
                          <input
                            type={type ?? 'text'}
                            value={row[key] ?? ''}
                            onChange={(e) => set(row.ref, key, e.target.value || null)}
                            className={inputClass}
                          />
                        </label>
                      ))}
                    </div>

                    <label className="block space-y-1">
                      <span className="label-caps text-muted-foreground">What they do</span>
                      <textarea
                        rows={3}
                        value={row.company_summary ?? ''}
                        onChange={(e) => set(row.ref, 'company_summary', e.target.value || null)}
                        placeholder="Nothing found — add a line yourself"
                        className="w-full px-2.5 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>

                    <label className="block space-y-1">
                      <span className="label-caps text-muted-foreground">Possible fit for Ber Wilson</span>
                      <textarea
                        rows={3}
                        value={row.fit_notes ?? ''}
                        onChange={(e) => set(row.ref, 'fit_notes', e.target.value || null)}
                        className="w-full px-2.5 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>

                    {row.tags.length > 0 && (
                      <div className="space-y-1">
                        <span className="label-caps text-muted-foreground">Tags</span>
                        <div className="flex flex-wrap gap-1.5">
                          {row.tags.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => set(row.ref, 'tags', row.tags.filter((x) => x !== t))}
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

                    {row.candidates.length > 0 && (
                      <label className="block space-y-1">
                        <span className="label-caps text-muted-foreground">Fill in which contact</span>
                        <select
                          value={row.link_target ?? ''}
                          onChange={(e) => {
                            const v = e.target.value || null
                            set(row.ref, 'link_target', v)
                            if (v) set(row.ref, 'action', 'link')
                          }}
                          className="w-full h-11 sm:h-9 px-2.5 rounded-md border border-input bg-background text-sm"
                        >
                          <option value="">— create a new contact —</option>
                          {row.candidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.full_name}
                              {c.company ? ` · ${c.company}` : ''}
                              {c.email ? ` · ${c.email}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {row.sources.length > 0 && (
                      <details className="space-y-1">
                        <summary className="label-caps text-muted-foreground cursor-pointer">
                          Sources ({row.sources.length})
                        </summary>
                        <div className="space-y-0.5 max-h-28 overflow-y-auto pt-1">
                          {row.sources.map((s, i) => (
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
                      <summary className="label-caps text-muted-foreground cursor-pointer">
                        Text read from the card
                      </summary>
                      <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap rounded-md bg-muted/30 p-2 max-h-40 overflow-y-auto">
                        {row.raw_text}
                      </pre>
                    </details>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      {failures.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded px-3 py-2">
          {failures.length} card{failures.length === 1 ? '' : 's'} could not be saved and {failures.length === 1 ? 'is' : 'are'} marked
          above. Everything else landed — fix {failures.length === 1 ? 'it' : 'them'} and save again.
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || selected.length === 0}
            className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save {selected.length} contact{selected.length === 1 ? '' : 's'}
          </button>
          <span className="text-xs text-muted-foreground">
            {rows.length - selected.length > 0 && `${rows.length - selected.length} skipped`}
          </span>
        </div>
      )}
    </div>
  )
}

function ActionPicker({ row, onChange }: { row: Row; onChange: (a: Action) => void }) {
  const options: Array<{ value: Action; label: string; icon: typeof UserPlus; disabled?: boolean }> = [
    { value: 'create', label: 'New', icon: UserPlus },
    { value: 'link', label: 'Fill in', icon: UserCheck, disabled: !row.link_target },
    { value: 'skip', label: 'Skip', icon: X },
  ]

  return (
    <div className="flex shrink-0 rounded-md border border-border overflow-hidden">
      {options.map(({ value, label, icon: Icon, disabled }) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value)}
          title={disabled ? 'No existing contact is matched to this card' : label}
          className={cn(
            'inline-flex items-center gap-1 h-11 sm:h-8 px-2 text-xs font-medium transition-colors border-l border-border first:border-l-0',
            row.action === value
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent text-muted-foreground disabled:opacity-40 disabled:hover:bg-transparent',
          )}
        >
          <Icon size={12} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}
