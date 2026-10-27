'use client'

/**
 * The ledger, with its close buttons — and with NO knowledge of the router.
 *
 * ⚠ SPLIT OUT SO IT CAN BE RENDERED IN A TEST, exactly as `AttentionList` was
 * and for the same failure. `useRouter`/`useSearchParams` throw "invariant
 * expected app router to be mounted" outside a Next request, so a component
 * that reads them cannot be exercised by `renderToStaticMarkup` — and §12 is
 * explicit that a listed route is not an answering one, and that behind auth a
 * curl returns the same redirect either way. Taking the filter as a prop and
 * the navigation as a callback makes the whole of what a reader sees
 * verifiable; `CommitmentsClient` is the thin wrapper that supplies them.
 *
 * THREE VERDICTS, NOT TWO, and that is the substance of this screen rather
 * than a nicety. With only "done" and "dismissed", a reader looking at a real
 * obligation that is not actionable today has to pick between two false
 * statements — and measured over eleven mornings against 476 open rows, what
 * they picked was neither: nothing was ever settled by anybody. "Quiet it"
 * keeps the row open, keeps it counted, and stops it shouting for a week.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, X, Clock, ArrowUpRight, Copy, Search, Handshake } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/card'
import { HeaderMetrics, PageHeader } from '@/components/ui/page-header'
import { Chip } from '@/components/ui/chip'
import { FIELD_CONTROL_CLASS } from '@/lib/utils/field-classes'
import type {
  CommitmentListItem,
  CommitmentListFilters,
  CommitmentListResult,
} from '@/lib/commitments/list'
import type { CommitmentSort } from '@/lib/commitments/read'
import { jaccard, phraseTokens } from '@/lib/utils/similarity'

type Verdict = 'done' | 'dismissed' | 'snoozed' | 'open'

const VIEWS: { key: NonNullable<CommitmentListFilters['view']>; label: string }[] = [
  { key: 'open', label: 'Live' },
  { key: 'quiet', label: 'Quieted' },
  { key: 'settled', label: 'Settled' },
  // What the aging pass closed. Its own tab rather than folded into Settled,
  // because a person deciding something is done and the platform noticing the
  // conversation died are two different events — §12: two quantities must be
  // named apart, and summing them would make "settled" measure nobody's work.
  { key: 'retired', label: 'Retired' },
  { key: 'all', label: 'All open' },
]

/**
 * Mark rows that look like the same obligation read off two conversations.
 *
 * ⚠ IT FLAGS AND NEVER FOLDS, AND THAT IS THE MEASURED CONCLUSION RATHER THAN
 * caution. The first version collapsed near-duplicates into one row using
 * `commitmentSimilarity`, the overlap coefficient the extractor already uses
 * for same-thread dedupe. Swept over the live ledger it folded 31 of 244 rows
 * — and the pairs it folded included "Sign the MNDA" ≡ "Sign the NDA",
 * "Sign and endorse the LOI" ≡ "Sign the LOI" across two different deals, and
 * "Sign the MNDA" ≡ "Sign and send the grid edge MNDA". The coefficient is
 * `shared / min(size)`, so a short phrase is a perfect subset of every longer
 * one containing it, and "Sign the MNDA" is a subset of half the ledger.
 * §12 records the same trap as four blank MNDAs for four counterparties:
 * identical bytes are not the same document when the name carries the only
 * distinction. Folding would have silently settled one counterparty's NDA by
 * ticking another's.
 *
 * So: Jaccard (which does not reward being a subset), a high bar, and the
 * result is a CHIP the reader can act on rather than a merge they cannot see.
 * At 0.8 it marks 18 pairs, every one of which is genuinely one obligation
 * read twice — and marking is safe even where it is wrong.
 */
const DUPLICATE_BAR = 0.8

/** Row id → how many OTHER rows say nearly the same thing. */
function duplicateCounts(rows: CommitmentListItem[]): Map<string, number> {
  const tokens = rows.map((r) => phraseTokens(r.what))
  const counts = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (jaccard(tokens[i], tokens[j]) < DUPLICATE_BAR) continue
      counts.set(rows[i].id, (counts.get(rows[i].id) ?? 0) + 1)
      counts.set(rows[j].id, (counts.get(rows[j].id) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * The orders on offer.
 *
 * Derived nowhere else — this and `CommitmentSort` in read.ts are the same
 * union, so the page's validation (`page.tsx`) and this row have to agree.
 * Declaration order is reading order (§12).
 */
const SORTS: { key: CommitmentSort; label: string }[] = [
  { key: 'newest', label: 'Newest found' },
  { key: 'activity', label: 'Latest reply' },
  { key: 'due', label: 'Due date' },
  { key: 'oldest', label: 'Oldest found' },
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
  if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: 'text-critical' }
  if (d === 0) return { text: 'due today', tone: 'text-caution' }
  if (d <= 3) return { text: `in ${d}d`, tone: 'text-caution' }
  return { text: `in ${d}d`, tone: 'text-muted-foreground' }
}

function ageLabel(created: string | null): string | null {
  if (!created) return null
  const days = Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000)
  return days >= 1 ? `found ${days}d ago` : 'found today'
}

/**
 * How long the CONVERSATION has been silent — a different question from how
 * long the row has existed, and the one that says whether this is still live.
 *
 * ⚠ ONLY SPOKEN WHEN IT IS NEWS. A thread that moved this week is the normal
 * case and saying so on 41 rows is noise; §12's rule about red having stopped
 * signifying applies to text just as much. It appears from a fortnight, which
 * is the point `aging.ts` calls an ordinary gap in a land deal, and reads as
 * plain muted text until it crosses the 21-day retirement bar.
 */
function silenceLabel(lastAt: string | null): { text: string; tone: string } | null {
  if (!lastAt) return null
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000)
  if (!isFinite(days) || days < 14) return null
  return {
    text: `thread quiet ${days}d`,
    tone: days >= 21 ? 'text-caution' : 'text-muted-foreground/70',
  }
}

export default function CommitmentsLedger({
  items,
  totals,
  filters,
  mailboxes,
  loadError,
  withheld,
  setParam,
}: {
  items: CommitmentListItem[]
  // ⚠ DERIVED, NOT RETYPED (§12). This was spelled out here and the server
  // added a fifth total, which a hand-written copy cannot notice.
  totals: CommitmentListResult['totals']
  filters: CommitmentListFilters
  mailboxes: string[]
  loadError: string | null
  withheld: number
  /**
   * Move a filter into the URL. Supplied by `CommitmentsClient`, which is the
   * only half that may touch the router — see the header there.
   */
  setParam: (key: string, value: string | null) => void
}) {
  const [rows, setRows] = useState(items)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState(filters.q ?? '')

  const view = filters.view ?? 'open'

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

  // Computed over the WHOLE visible set, not per section: the same obligation
  // read off two threads can land on different sides, and the pair is exactly
  // what the reader needs to see in that case.
  const duplicates = useMemo(() => duplicateCounts(visible), [visible])

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        icon={Handshake}
        title="Commitments"
        className="mb-0"
        description="Every obligation read out of correspondence. Tick what is done, quiet what is real but not today, and dismiss what was never a commitment of ours."
      />

      {/*
        ONE QUANTITY, ONE DEFINITION (§12) — five different questions about one
        table, named apart and never summed.

        ⚠ THEY WERE FIVE CHIPS AT 13px, indistinguishable from the filter chips
        below them and from every other chip on the page: *"210 open"*,
        *"171 with no agreed date"*, *"221 settled"* read as controls rather
        than as the state of the ledger. `HeaderMetrics` is the shared strip
        for exactly this — the figure in ink at body weight, its label muted
        beside it — and it is deliberately NOT four `StatTile`s, because a
        30px number at the top of a list page competes with the list for the
        thing the page exists to show.
      */}
      <HeaderMetrics
        items={[
          { label: 'open', value: totals.open },
          { label: 'with no agreed date', value: totals.undated, tone: totals.undated > 0 ? 'caution' : 'default' },
          ...(totals.quiet > 0 ? [{ label: 'quieted', value: totals.quiet }] : []),
          { label: 'settled', value: totals.settled, tone: 'positive' as const },
          ...(totals.retired > 0 ? [{ label: 'retired as stale', value: totals.retired }] : []),
        ]}
      />

      {loadError && (
        <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-critical">
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
                'min-h-[2.75rem] sm:min-h-9 rounded-md px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                view === v.key ? 'bg-card text-foreground font-medium elev-1' : 'text-muted-foreground hover:text-foreground'
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
                'min-h-[2.75rem] sm:min-h-9 rounded-md px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                filters.side === s ? 'bg-card text-foreground font-medium elev-1' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s === 'us' ? 'We owe' : s === 'them' ? 'Waiting on' : 'Both'}
            </button>
          ))}
        </div>

        {/* Ordering. A select rather than a fourth button row: four more
            buttons would wrap the toolbar on a phone, and unlike the view and
            side toggles this is a preference rather than a place. */}
        <select
          value={filters.sort ?? 'newest'}
          onChange={(e) => setParam('sort', e.target.value === 'newest' ? null : e.target.value)}
          aria-label="Sort order"
          className={cn(FIELD_CONTROL_CLASS, 'w-auto max-w-[11rem]')}
        >
          {SORTS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>

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
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground elev-1">
          {rows.length === 0
            ? view === 'settled'
              ? 'Nothing has been settled yet.'
              : view === 'retired'
                ? 'Nothing has been retired as stale.'
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
            duplicates={duplicates}
            settledView={view === 'settled' || view === 'retired'}
          />
          <Section
            title="Waiting on"
            hint="Others owe us these — the follow-up candidates."
            list={awaited}
            settle={settle}
            copyChase={copyChase}
            busy={busy}
            duplicates={duplicates}
            settledView={view === 'settled' || view === 'retired'}
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
  duplicates,
  settledView,
}: {
  title: string
  hint: string
  list: CommitmentListItem[]
  settle: (id: string, verdict: Verdict) => void
  copyChase: (text: string) => void
  busy: string | null
  duplicates: Map<string, number>
  settledView: boolean
}) {
  if (list.length === 0) return null

  return (
    <Panel>
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
          const silence = silenceLabel(c.thread_last_at)
          const alike = duplicates.get(c.id) ?? 0
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
                    {silence && <span className={cn('tnum', silence.tone)}>{silence.text}</span>}
                    {alike > 0 && (
                      // Flagged, never folded — see duplicateCounts. The
                      // reader decides; nothing is merged behind their back.
                      <span
                        className="text-muted-foreground/70"
                        title="Another conversation carries what looks like the same obligation. Nothing is merged — check both before settling either."
                      >
                        {alike === 1 ? 'also said elsewhere' : `also said on ${alike} others`}
                      </span>
                    )}
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
                      hover="hover:text-positive"
                    >
                      <Check className="size-4" />
                    </RowButton>
                    <RowButton
                      onClick={() => settle(c.id, 'snoozed')}
                      disabled={busy === c.id}
                      label={`Quiet for a week: ${c.what}`}
                      title="Real, but not today — quiet it for a week"
                      hover="hover:text-caution"
                    >
                      <Clock className="size-4" />
                    </RowButton>
                    <RowButton
                      onClick={() => settle(c.id, 'dismissed')}
                      disabled={busy === c.id}
                      label={`Dismiss: ${c.what}`}
                      title="Never a real commitment"
                      hover="hover:text-critical"
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
                      className="mt-2 inline-flex min-h-[2.75rem] sm:min-h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
    </Panel>
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
      <span className="tap-target" aria-hidden />
      {children}
    </button>
  )
}
