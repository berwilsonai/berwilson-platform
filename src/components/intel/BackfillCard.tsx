'use client'

/**
 * One-time RAG backfill runner (removable once all four targets report zero).
 * Loops the batched /api/admin/backfill-embeddings endpoint until each target
 * reports remaining: 0, or progress stalls.
 */

import { useState } from 'react'
import { Database, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

const TARGETS = [
  { key: 'project_documents', label: 'Project & vendor PDFs' },
  { key: 'opportunity_documents', label: 'Opportunity documents' },
  { key: 'opportunities', label: 'Opportunity records' },
  { key: 'opportunity_notes', label: 'Opportunity notes' },
] as const

type TargetKey = (typeof TARGETS)[number]['key']

interface TargetState {
  running: boolean
  done: boolean
  processed: number
  remaining: number | null
  error: string | null
}

const initialState = (): TargetState => ({
  running: false,
  done: false,
  processed: 0,
  remaining: null,
  error: null,
})

export default function BackfillCard() {
  const [states, setStates] = useState<Record<TargetKey, TargetState>>({
    project_documents: initialState(),
    opportunity_documents: initialState(),
    opportunities: initialState(),
    opportunity_notes: initialState(),
  })

  const patch = (key: TargetKey, s: Partial<TargetState>) =>
    setStates((prev) => ({ ...prev, [key]: { ...prev[key], ...s } }))

  async function run(key: TargetKey) {
    patch(key, { running: true, error: null, processed: 0, remaining: null })
    let total = 0
    let lastRemaining = Infinity

    for (;;) {
      let res: Response
      try {
        res = await fetch('/api/admin/backfill-embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: key }),
        })
      } catch {
        patch(key, { running: false, error: 'Network error — try again.' })
        return
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        patch(key, { running: false, error: data.error ?? `Failed (${res.status})` })
        return
      }

      total += data.processed ?? 0
      const remaining = data.remaining ?? 0
      patch(key, { processed: total, remaining })

      if (remaining <= 0) {
        patch(key, { running: false, done: true })
        return
      }
      // Stall guard: nothing processed and remaining not shrinking → stop
      if ((data.processed ?? 0) === 0 && remaining >= lastRemaining) {
        patch(key, {
          running: false,
          error: `Stalled with ${remaining} item(s) left${data.errors?.length ? ` — ${data.errors[0]}` : ''}`,
        })
        return
      }
      lastRemaining = remaining
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center gap-2 mb-1">
        <Database size={14} className="text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Search index backfill</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        One-time: index existing PDFs, opportunity documents, records, and notes so they&apos;re
        searchable here. Runs in batches — leave the tab open. Requires the latest DB migration.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {TARGETS.map((t) => {
          const s = states[t.key]
          return (
            <div key={t.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">{t.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {s.error ? (
                    <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                      <AlertTriangle size={10} /> {s.error}
                    </span>
                  ) : s.done ? (
                    <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 size={10} /> Done — {s.processed} indexed
                    </span>
                  ) : s.running ? (
                    `${s.processed} indexed${s.remaining != null ? `, ${s.remaining} left` : ''}…`
                  ) : (
                    'Not run yet'
                  )}
                </div>
              </div>
              <button
                onClick={() => run(t.key)}
                disabled={s.running}
                className="shrink-0 text-xs font-medium rounded-md border border-border px-2.5 py-1 hover:bg-accent disabled:opacity-50"
              >
                {s.running ? <Loader2 size={12} className="animate-spin" /> : s.done ? 'Re-run' : 'Run'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
