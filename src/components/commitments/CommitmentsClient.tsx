'use client'

/**
 * The ledger, with its close buttons.
 *
 * THREE VERDICTS, NOT TWO, and that is the substance of this screen rather
 * than a nicety. With only "done" and "dismissed", a reader looking at a real
 * obligation that is not actionable today has to pick between two false
 * statements — and measured over eleven mornings against 476 open rows, what
 * they picked was neither: nothing was ever settled by anybody. "Quiet it"
 * keeps the row open, keeps it counted, and stops it shouting for a week.
 *
 * ⚠ THE FILTERS LIVE IN THE URL. §12 (10-03): a filter kept only in component
 * state is not a view — it cannot be linked, bookmarked or sent to anyone,
 * which reads as the thing having no page. `history.replaceState` keeps the
 * round trip off the server, since every row is already in hand.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, X, Clock, ArrowUpRight, Copy, Search } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { FIELD_CONTROL_CLASS } from '@/lib/utils/field-classes'
import type { CommitmentListItem, CommitmentListFilters } from '@/lib/commitments/list'

type Verdict = 'done' | 'dismissed' | 'snoozed' | 'open'

const VIEWS: { key: NonNullable<CommitmentListFilters['view']>; label: string }[] = [
  { key: 'open', label: 'Live' },
  { key: 'quiet', label: 'Quieted' },
  { key: 'settled', label: 'Settled' },
  { key: 'all', label: 'All open' },
]

function daysUntil(date: string): number | null {
  const t = new Date(`${date}T00:00:00`).getTime()
  if (!isFinite(t)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((t - today.getTime()) / 86_400_000)
}

/**
 * Banded, never all-red. §12: nine consecutive rows in alarm colour is red
 * having stopped signifying — past a month an obligation is history, still
 * listed and still settleable, no longer shouting.
 */
function dueLabel(date: string | null): { text: string; tone: string } {
  if (!date) return { text: 'no date agreed', tone: 'text-muted-foreground' }
  const d = daysUntil(date)
  if (d === null) return { text: date, tone: 'text-muted-foreground' }
  if (d < -30) return { text: `${Math.abs(d)}d overdue`, tone: 'text-muted-foreground' }
  if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: 'text-red-600 dark:text-red-400' }
  if (d === 0) return { text: 'due today', tone: 'text-amber-600 dark:text-amber-400' }
  if (d <= 3) return { text: `in ${d}d`, tone: 'text-amber-600 dark:text-amber-400' }
  return { text: `in ${d}d`, tone: 'text-muted-foreground' }
}

function ageLabel(created: string | null): string | null {
  if (!created) return null
  const days = Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000)
  return days >= 1 ? `found ${days}d ago` : 'found today'
}

export default function CommitmentsClient({
  items,
  totals,
  filters,
  mailboxes,
  loadError,
  withheld,
}: {
  items: CommitmentListItem[]
  totals: { open: number; quiet: number; settled: number; undated: number }
  filters: CommitmentListFilters
  mailboxes: string[]
  loadError: string | null
  withheld: number
}) {
  const [rows, setRows] = useState(items)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState(filters.q ?? '')

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const view = filters.view ?? 'open'

  /**
   * Move a filter into the URL.
   *
   * `router.replace` rather than `window.location.href`: the row set comes from
   * the server, so the view genuinely has to be re-fetched — but a client-side
   * navigation re-renders the one page instead of reloading the app shell, and
   * assigning to `window.location` is a mutation the React Compiler refuses
   * outright. `replace` rather than `push` keeps the back button meaning "the
   * page before this one" rather than walking back through filter changes.
   *
   * The search box below is NOT routed — it filters rows already in hand, so
   * typing never touches the server.
   */
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const visible = useMemo(() => {
    if (!q.trim()) return rows
    const needle = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        r.what.toLowerCase().includes(needle) ||
        (r.owner_name ?? '').toLowerCase().includes(needle) ||
        (r.record_name ?? '').toLowerCase().includes(needle)
    )
  }, [rows, q])

  async function settle(id: string, verdict: Verdict) {
    const previous = rows
    setBusy(id)
    // Optimistic with a real revert: a row that silently returns on the next
    // refresh reads as a bug, and one that never leaves reads as a dead button.
    setRows((r) => r.filter((x) => x.id !== id))
    try {
      const res = await fetch(`/api/commitments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: verdict }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Request failed')
      toast.success(
        verdict === 'done'
          ? 'Marked done'
          : verdict === 'dismissed'
            ? 'Dismissed — it will not be raised again'
            : 'Quieted for a week — it stays on the ledger'
      )
    } catch (err) {
      setRows(previous)
      toast.error(err instanceof Error ? err.message : 'Could not update')
    } finally {
      setBusy(null)
    }
  }

  async function copyChase(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Chase copied — paste it into the thread')
    } catch {
      toast.error('Could not reach the clipboard')
    }
  }

  const owed = visible.filter((r) => r.side === 'us')
  const awaited = visible.filter((r) => r.side === 'them')

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold">Commitments</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every obligation read out of correspondence. Tick what is done, quiet what is real but
          not today, and dismiss what was never a commitment of ours.
        </p>
      </header>

      {/* ONE QUANTITY, ONE DEFINITION (§12) — these are four different
          questions about one table, named apart and never summed. */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Chip>{totals.open} open</Chip>
        <Chip>{totals.undated} with no agreed date</Chip>
        {totals.quiet > 0 && <Chip>{totals.quiet} quieted</Chip>}
        <Chip>{totals.settled} settled</Chip>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-red-600 dark:text-red-400">
          The ledger could not be read in full: {loadError}
        </p>
      )}
      {withheld > 0 && (
        // §12: withholding from a reader means handing them the count, or a
        // trimmed list is confidently wrong about its own completeness.
        <p className="text-xs text-muted-foreground">
          {withheld} {withheld === 1 ? 'row belongs' : 'rows belong'} to a protected project and
          {withheld === 1 ? ' is' : ' are'} not shown here.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setParam('view', v.key === 'open' ? null : v.key)}
              className={cn(
                'min-h-9 rounded-md px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                view === v.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
          {([undefined, 'us', 'them'] as const).map((s) => (
            <button
              key={s ?? 'both'}
              type="button"
              onClick={() => setParam('side', s ?? null)}
              className={cn(
                'min-h-9 rounded-md px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                filters.side === s ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              )}
            >
              {s === 'us' ? 'We owe' : s === 'them' ? 'Waiting on' : 'Both'}
            </button>
          ))}
        </div>

        {/* Bounded: a native select sizes to its widest option, and a long
            mailbox would otherwise stretch this row and wrap the rest (§12). */}
        <select
          value={filters.mailbox ?? ''}
          onChange={(e) => setParam('mailbox', e.target.value || null)}
          aria-label="Filter by mailbox"
          className={cn(FIELD_CONTROL_CLASS, 'w-auto max-w-[14rem]')}
        >
          <option value="">Every mailbox</option>
          {mailboxes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the obligation or the person"
            aria-label="Search commitments"
            className={cn(FIELD_CONTROL_CLASS, 'pl-9')}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground elev-1">
          {rows.length === 0
            ? view === 'settled'
              ? 'Nothing has been settled yet.'
              : view === 'quiet'
                ? 'Nothing is quieted — every open obligation is live.'
                : 'Nothing open. The ledger is clear.'
            : 'No obligation matches that search.'}
        </p>
      ) : (
        <div className="space-y-4">
          <Section
            title="We owe"
            hint="Outstanding on our side."
            list={owed}
            settle={settle}
            copyChase={copyChase}
            busy={busy}
            settledView={view === 'settled'}
          />
          <Section
            title="Waiting on"
            hint="Others owe us these — the follow-up candidates."
            list={awaited}
            settle={settle}
            copyChase={copyChase}
            busy={busy}
            settledView={view === 'settled'}
          />
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  hint,
  list,
  settle,
  copyChase,
  busy,
  settledView,
}: {
  title: string
  hint: string
  list: CommitmentListItem[]
  settle: (id: string, verdict: Verdict) => void
  copyChase: (text: string) => void
  busy: string | null
  settledView: boolean
}) {
  if (list.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card elev-1">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <div>
          <span className="label-caps text-muted-foreground">{title}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="text-xs text-muted-foreground tnum">{list.length}</span>
      </div>
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
            <li key={c.id} className="px-4 py-3 hover:bg-accent">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.what}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {c.owner_name && <span className="text-muted-foreground">{c.owner_name}</span>}
                    <span className={cn('tnum', due.tone)}>{due.text}</span>
                    {age && <span className="text-muted-foreground/70 tnum">{age}</span>}
                    {c.mailbox && <span className="text-muted-foreground/70">{c.mailbox}</span>}
                    {c.snoozed_until && (
                      <span className="text-muted-foreground">quiet until {c.snoozed_until}</span>
                    )}
                    {href && c.record_name && (
                      // A sibling of the row's buttons, never nested inside
                      // one — a button inside an anchor is invalid markup.
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

                {!settledView && (
                  <div className="flex shrink-0 items-center gap-1">
                    <RowButton
                      onClick={() => settle(c.id, 'done')}
                      disabled={busy === c.id}
                      label={`Mark done: ${c.what}`}
                      title="Done"
                      hover="hover:text-emerald-600"
                    >
                      <Check className="size-4" />
                    </RowButton>
                    <RowButton
                      onClick={() => settle(c.id, 'snoozed')}
                      disabled={busy === c.id}
                      label={`Quiet for a week: ${c.what}`}
                      title="Real, but not today — quiet it for a week"
                      hover="hover:text-amber-600"
                    >
                      <Clock className="size-4" />
                    </RowButton>
                    <RowButton
                      onClick={() => settle(c.id, 'dismissed')}
                      disabled={busy === c.id}
                      label={`Dismiss: ${c.what}`}
                      title="Never a real commitment"
                      hover="hover:text-red-600"
                    >
                      <X className="size-4" />
                    </RowButton>
                  </div>
                )}
              </div>

              {c.chase_text && (
                /**
                 * The drafted follow-up, offered for copying.
                 *
                 * ⚠ IT IS HERE RATHER THAN IN GMAIL FOR A MEASURED REASON. Of
                 * 231 commitments owed to us, 223 sit on threads in
                 * moose@/tuaone@, which hold read-only Gmail scope by design
                 * (§12) — only the 8 on info@ can hold a draft at all. So the
                 * text is composed either way and the reader sends it from
                 * their own client. A real in-thread draft is created where the
                 * mailbox permits it, and `chase_drafted_at` says which.
                 */
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary outline-none focus-visible:underline">
                    {c.chase_drafted_at
                      ? 'Chase drafted in Gmail — show the text'
                      : 'A chase is ready to send'}
                  </summary>
                  <div className="mt-2 rounded-lg border border-border bg-background p-3">
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {c.chase_text}
                    </p>
                    <button
                      type="button"
                      onClick={() => copyChase(c.chase_text!)}
                      className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Copy className="size-3.5" aria-hidden />
                      Copy
                    </button>
                  </div>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A row control with a 44px touch target that does not shift the row. */
function RowButton({
  onClick,
  disabled,
  label,
  title,
  hover,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  title: string
  hover: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        'relative grid size-7 place-items-center rounded-md text-muted-foreground outline-none',
        'hover:bg-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:opacity-40',
        hover
      )}
    >
      {/* Grown with an inset overlay rather than padding, or the row shifts
          under the next tap (§12, 08-27). */}
      <span className="absolute -inset-3" aria-hidden />
      {children}
    </button>
  )
}
