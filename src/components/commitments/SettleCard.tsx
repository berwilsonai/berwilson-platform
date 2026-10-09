'use client'

/**
 * The confirmation card behind a morning-note link.
 *
 * Three verdicts, because two was the trap. With only "done" and "dismissed"
 * available, a reader looking at an obligation that is real, still outstanding,
 * and not actionable today has to choose between two lies — and measured over
 * eleven mornings against 476 open rows, what they actually chose was neither:
 * nothing was ever settled at all. "Quiet it for a week" is the honest third
 * answer, and it is why this ledger can now reach zero.
 */

import { useState } from 'react'
import { Check, X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

type Verdict = 'done' | 'dismissed' | 'snoozed'

const COPY: Record<Verdict, { label: string; hint: string; done: string }> = {
  done: {
    label: 'Done',
    hint: 'It happened — close it.',
    done: 'Marked done. It is off the ledger.',
  },
  snoozed: {
    label: 'Not today',
    hint: 'Still real. Quiet it for a week.',
    done: 'Quieted for a week. It stays on the ledger and comes back.',
  },
  dismissed: {
    label: 'Never mine',
    hint: 'A misread — this was never a commitment of ours.',
    done: 'Dismissed. It will not be raised again.',
  },
}

function daysAgo(iso: string | null): string | null {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d >= 1 ? `found in the mail ${d}d ago` : 'found in the mail today'
}

export default function SettleCard({
  token,
  what,
  side,
  dueDate,
  ownerName,
  createdAt,
}: {
  token: string
  what: string
  side: 'us' | 'them'
  dueDate: string | null
  ownerName: string | null
  createdAt: string | null
}) {
  const [busy, setBusy] = useState<Verdict | null>(null)
  const [settled, setSettled] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(verdict: Verdict) {
    setBusy(verdict)
    setError(null)
    try {
      const res = await fetch('/api/commitments/settle-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, verdict }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not record that')
      setSettled(verdict)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that')
    } finally {
      setBusy(null)
    }
  }

  if (settled) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 elev-1">
        <div className="flex items-center gap-2">
          <Check className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <h1 className="text-base font-semibold">{COPY[settled].label}</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{COPY[settled].done}</p>
        <p className="mt-4 border-t border-border pt-3 text-sm">{what}</p>
        <a
          href="/commitments"
          className="mt-5 inline-flex h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          See the rest
        </a>
      </div>
    )
  }

  const age = daysAgo(createdAt)

  return (
    <div className="rounded-xl border border-border bg-card p-6 elev-1">
      <span className="label-caps text-muted-foreground">
        {side === 'us' ? 'You owe this' : 'You are waiting on this'}
      </span>
      <h1 className="mt-2 text-base font-semibold leading-snug">{what}</h1>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {/* Absence is stated, never blank — a row with no date must not read as
            one whose date simply was not rendered. */}
        <span className="tnum">{dueDate ? `due ${dueDate}` : 'no date agreed'}</span>
        {ownerName && <span>· extraction named {ownerName}</span>}
        {age && <span>· {age}</span>}
      </p>

      <div className="mt-5 space-y-2">
        {(['done', 'snoozed', 'dismissed'] as Verdict[]).map((v) => (
          <button
            key={v}
            type="button"
            disabled={busy !== null}
            onClick={() => submit(v)}
            // 44px minimum touch target — this is read on a phone and nothing
            // else on the page competes for the tap (§12).
            className={cn(
              'flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left outline-none transition-colors',
              'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              'disabled:opacity-50',
              v === 'done'
                ? 'border-border bg-primary text-primary-foreground hover:opacity-90'
                : 'border-border hover:bg-accent'
            )}
          >
            {v === 'done' ? (
              <Check className="size-4 shrink-0" aria-hidden />
            ) : v === 'snoozed' ? (
              <Clock className="size-4 shrink-0" aria-hidden />
            ) : (
              <X className="size-4 shrink-0" aria-hidden />
            )}
            <span>
              <span className="block text-sm font-semibold">{COPY[v].label}</span>
              <span
                className={cn(
                  'block text-xs',
                  v === 'done' ? 'text-primary-foreground/80' : 'text-muted-foreground'
                )}
              >
                {COPY[v].hint}
              </span>
            </span>
            {busy === v && <span className="ml-auto text-xs">saving…</span>}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
        From Pepper’s morning note. Nothing was sent on your behalf.
      </p>
    </div>
  )
}
