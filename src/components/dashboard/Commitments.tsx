'use client'

/**
 * The commitments panel — what we owe, and what we are waiting on.
 *
 * This is the half of an assistant that a digest alone cannot be: a digest is
 * read once and scrolls away, while an obligation stays true until somebody
 * settles it. Every row here was read out of correspondence, so the panel is
 * showing work that exists nowhere else in the platform.
 *
 * Settling is ONE CLICK on the row, for the same reason the dev-notes build
 * made it one click: a ledger that takes four clicks to close stays open, and a
 * ledger everyone has stopped closing is worse than none — it reports stale
 * obligations with total confidence.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Check, X, Clock, ArrowUpRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface CommitmentItem {
  id: string
  what: string
  side: 'us' | 'them'
  owner_name: string | null
  due_date: string | null
  created_at: string | null
  project_id: string | null
  opportunity_id: string | null
  record_name: string | null
}

function daysUntil(date: string): number | null {
  const t = new Date(`${date}T00:00:00`).getTime()
  if (!isFinite(t)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((t - today.getTime()) / 86_400_000)
}

function dueLabel(date: string | null): { text: string; tone: string } | null {
  // Absence is stated, never blank. A row with no date must not read as a row
  // whose date simply was not rendered — no date was ever agreed, and saying so
  // is the difference between an honest ledger and an implied deadline.
  if (!date) return { text: 'no date agreed', tone: 'text-muted-foreground' }
  const d = daysUntil(date)
  if (d === null) return { text: date, tone: 'text-muted-foreground' }
  if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: 'text-red-600 dark:text-red-400' }
  if (d === 0) return { text: 'due today', tone: 'text-amber-600 dark:text-amber-400' }
  if (d <= 3) return { text: `in ${d}d`, tone: 'text-amber-600 dark:text-amber-400' }
  return { text: `in ${d}d`, tone: 'text-muted-foreground' }
}

function ageLabel(created: string | null): string | null {
  if (!created) return null
  const days = Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000)
  return days >= 1 ? `${days}d` : null
}

export default function Commitments({ items }: { items: CommitmentItem[] }) {
  const [rows, setRows] = useState(items)
  const [busy, setBusy] = useState<string | null>(null)

  async function settle(id: string, status: 'done' | 'dismissed') {
    const previous = rows
    setBusy(id)
    // Optimistic, with a real revert. A row that silently reappears on the next
    // refresh reads as a bug; a row that never leaves reads as a dead button.
    setRows((r) => r.filter((x) => x.id !== id))
    try {
      const res = await fetch(`/api/commitments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Request failed')
      toast.success(status === 'done' ? 'Marked done' : 'Dismissed')
    } catch (err) {
      setRows(previous)
      toast.error(err instanceof Error ? err.message : 'Could not update')
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) return null

  const owed = rows.filter((r) => r.side === 'us')
  const awaited = rows.filter((r) => r.side === 'them')

  const section = (title: string, hint: string, list: CommitmentItem[]) => {
    if (list.length === 0) return null
    return (
      <div>
        <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
          <span className="label-caps text-muted-foreground">{title}</span>
          <span className="text-xs text-muted-foreground tnum">{list.length}</span>
        </div>
        <p className="px-4 pb-2 text-xs text-muted-foreground">{hint}</p>
        <ul className="divide-y divide-border">
          {list.map((c) => {
            const due = dueLabel(c.due_date)
            const age = ageLabel(c.created_at)
            const href = c.project_id
              ? `/projects/${c.project_id}`
              : c.opportunity_id
                ? `/opportunities/${c.opportunity_id}`
                : null
            return (
              <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.what}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {c.owner_name && <span className="text-muted-foreground">{c.owner_name}</span>}
                    {due && <span className={cn('tnum', due.tone)}>{due.text}</span>}
                    {age && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground tnum">
                        <Clock className="size-3" /> {age}
                      </span>
                    )}
                    {href && c.record_name && (
                      // A sibling of the row, never nested inside another
                      // anchor or button — a button inside an anchor is invalid
                      // markup and behaves differently across browsers.
                      <Link
                        href={href}
                        className="inline-flex items-center gap-0.5 text-primary hover:underline"
                      >
                        {c.record_name}
                        <ArrowUpRight className="size-3" />
                      </Link>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => settle(c.id, 'done')}
                    title="Mark done"
                    aria-label={`Mark done: ${c.what}`}
                    className="relative grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-emerald-600 disabled:opacity-40"
                  >
                    {/* Grows the touch target to 44px without moving the row —
                        padding here would shift every row below it under the
                        next tap, the mobile failure the 08-27 pass fixed. */}
                    <span className="absolute -inset-3" aria-hidden />
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => settle(c.id, 'dismissed')}
                    title="Not a real commitment"
                    aria-label={`Dismiss: ${c.what}`}
                    className="relative grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-red-600 disabled:opacity-40"
                  >
                    <span className="absolute -inset-3" aria-hidden />
                    <X className="size-4" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card elev-1">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Commitments</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Read out of correspondence. Tick to settle, ✕ if it was never a real commitment.
        </p>
      </div>
      {section('We owe', 'Outstanding on our side.', owed)}
      {section('Waiting on', 'Others owe us these — follow-up candidates.', awaited)}
    </div>
  )
}
