'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BellOff, CircleCheck, Loader2, RotateCcw, Trash2 } from 'lucide-react'

import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Kbd } from '@/components/ui/kbd'
import EmptyState from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import {
  ATTENTION_DISMISS_DAYS,
  ATTENTION_KINDS,
  attentionDeleteTarget,
  attentionHref,
  attentionKind,
  urgencyBand,
  type AttentionCategory,
} from '@/lib/attention-kinds'

export interface AttentionRow {
  id: string
  category: AttentionCategory
  urgency: number
  title: string
  detail: string
  project_id: string | null
  project_name: string
  age_days: number
  due_date: string | null
}

/** A dismissal, as the Dismissed view reads it. */
export interface DismissedRow {
  item_key: string
  category: string
  title: string
  project_name: string | null
  dismissed_until: string
  dismissed_by: string | null
}

/**
 * The attention list, with no knowledge of the URL, the router or fetch.
 *
 * ⚠ SPLIT OUT SO IT CAN BE RENDERED IN A TEST. `useSearchParams` and
 * `useRouter` throw "invariant expected app router to be mounted" outside a
 * Next request, so a component that reads them cannot be exercised by
 * `renderToStaticMarkup` — and §12 is explicit that a listed route is not an
 * answering one and a curl behind auth cannot tell you which. Taking the active
 * filter as a prop and every navigation and every WRITE as a callback makes the
 * whole of what a reader sees verifiable; `AttentionClient` is the thin wrapper
 * that supplies them.
 *
 * ── THE QUICK ACTIONS (10-20) ────────────────────────────────────────────────
 *
 * ⚠ THE ROWS HAD NO VERBS AT ALL, FOR ANY OF THE TEN KINDS. The only thing a
 * reader could do with a row was open it. Richard's words: *"it shows me leads
 * and other items that are urgent, but I don't have a quick button to simply
 * delete them."* The engine's own comment on leads had been promising one all
 * along — *"an already-closed one stays loud until somebody dismisses it"* —
 * and nothing ever built the dismiss.
 *
 * Two verbs, and WHICH ones a row gets is read off the registry rather than
 * decided here (§12: a hand-written enumeration beside a registry drifts, and
 * `/decide` shipped a kind that got a count and no chip for exactly this
 * reason):
 *
 *   Delete   — only the four kinds whose row can honestly be deleted, through
 *              the route that already owns it. `attentionDeleteTarget()`
 *              returns null for the rest and NO BUTTON IS RENDERED rather than
 *              a dead one.
 *   Dismiss  — every kind, because "not now" always makes sense. Writes a mark
 *              the engine respects for two weeks; see attention-dismissals.ts.
 *
 * ⚠ COMPLETE IS DELIBERATELY ABSENT. Ticking an overdue task is the task
 * board's native verb one click away through this row's own link, and §12's
 * rule about a shared renderer cuts both ways: a second place to mark a task
 * done is a second definition of done. Richard's point was the opposite one —
 * completing a task that should be deleted falsifies the activity log.
 *
 * ⚠ AND THE ROW IS NO LONGER A `<Link>` WRAPPING EVERYTHING. A button inside an
 * anchor is invalid HTML and browsers resolve it by firing both, so the first
 * Delete press would have navigated away mid-request. The title carries the
 * anchor and stretches over the row with `after:absolute after:inset-0`; the
 * actions sit above it on their own stacking context. The whole row stays
 * clickable and the keyboard still lands on one real link per row.
 */
export default function AttentionList({
  items,
  dismissed,
  active,
  view,
  busy,
  onFilter,
  onView,
  onOpen,
  onDismiss,
  onDelete,
  onRestore,
}: {
  items: AttentionRow[]
  /** Dismissals still in force, for the Dismissed view and its restore. */
  dismissed: DismissedRow[]
  /** The category being filtered to, or null for everything. */
  active: string | null
  /** Which list is on screen. A view is a URL, never component state (§12). */
  view: 'open' | 'dismissed'
  /** Item keys with a write in flight, so a row cannot be double-pressed. */
  busy: ReadonlySet<string>
  onFilter: (kind: string | null) => void
  onView: (view: 'open' | 'dismissed') => void
  onOpen: (href: string) => void
  onDismiss: (row: AttentionRow) => void
  onDelete: (row: AttentionRow) => void
  onRestore: (itemKey: string) => void
}) {
  const rows = active ? items.filter((i) => i.category === active) : items

  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Counts per kind, derived — never a hand-written map beside the registry.
  const counts = new Map<AttentionCategory, number>()
  for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1)

  function setKind(kind: string | null) {
    onFilter(kind)
    setCursor(0)
  }

  /*
    The keyboard. Modifier combinations fall through so ⌘K and ⌘J still work,
    and so does anything typed into a field.

    ⚠ THE DESTRUCTIVE SHORTCUT GOES THROUGH THE SAME `onDelete` AS THE BUTTON,
    which opens the confirmation in the client rather than deleting here. A
    keystroke that destroys a record with no confirmation is not a shortcut.
  */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (view !== 'open') return

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(rows.length - 1, c + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter') {
        const row = rows[cursor]
        if (row) onOpen(attentionHref(row.category, row.project_id))
      } else if (e.key === 'd') {
        const row = rows[cursor]
        if (row && !busy.has(row.id)) {
          e.preventDefault()
          onDismiss(row)
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        const row = rows[cursor]
        if (row && attentionDeleteTarget(row.category, row.id) && !busy.has(row.id)) {
          e.preventDefault()
          onDelete(row)
        }
      } else if (e.key === 'Escape') {
        if (active) setKind(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cursor, active, view, busy, onFilter, onOpen, onDismiss, onDelete])

  // Keep the cursor row in view without yanking the page around it.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  /* ── The Dismissed view ───────────────────────────────────────────────────
     Rendered from the stored dismissals, not from live items: by definition the
     engine is no longer producing these, so the snapshot taken at dismissal is
     the only thing there is to show. Its one verb is Restore, which deletes the
     mark and lets the engine rebuild the item on the next read. */
  if (view === 'dismissed') {
    return (
      <div className="space-y-4">
        <ViewTabs view={view} onView={onView} open={items.length} quiet={dismissed.length} />
        {dismissed.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nothing dismissed"
            description="Items you push out of sight land here until they come back on their own."
            action={
              <button type="button" onClick={() => onView('open')} className="text-xs text-primary hover:underline">
                Back to what needs you
              </button>
            }
          />
        ) : (
          <Panel className="overflow-hidden">
            {dismissed.map((d) => {
              const label = ATTENTION_KINDS.find((k) => k.category === d.category)?.label ?? d.category
              const tone = ATTENTION_KINDS.find((k) => k.category === d.category)?.tone
              return (
                <div
                  key={d.item_key}
                  className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={tone}>{label}</Chip>
                      {d.project_name && (
                        <span className="truncate text-xs text-muted-foreground">{d.project_name}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-muted-foreground">{d.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Back on {formatDay(d.dismissed_until)}
                      {d.dismissed_by ? ` · dismissed by ${d.dismissed_by}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(d.item_key)}
                    disabled={busy.has(d.item_key)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    {busy.has(d.item_key) ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    Restore
                  </button>
                </div>
              )
            })}
          </Panel>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ViewTabs view={view} onView={onView} open={items.length} quiet={dismissed.length} />

      {/* Chips, derived from the registry. A kind with nothing in it is not
          shown — but the one you are filtered to always is, or it vanishes from
          under you the moment the last item clears. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setKind(null)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            !active ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card text-muted-foreground ring-border hover:text-foreground'
          )}
        >
          Everything <span className="tnum ml-1">{items.length}</span>
        </button>
        {ATTENTION_KINDS.filter((k) => (counts.get(k.category) ?? 0) > 0 || active === k.category).map((k) => {
          const n = counts.get(k.category) ?? 0
          const on = active === k.category
          return (
            <button
              key={k.category}
              type="button"
              onClick={() => setKind(on ? null : k.category)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                on ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card text-muted-foreground ring-border hover:text-foreground'
              )}
            >
              {k.label} <span className="tnum ml-1">{n}</span>
            </button>
          )
        })}
      </div>

      {/* The shortcuts, stated rather than discovered — and only where there is
          a keyboard to press them with. */}
      {rows.length > 1 && (
        <p className="hidden sm:flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
          <span><Kbd>j</Kbd> <Kbd>k</Kbd> move</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>↵</Kbd> open</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>d</Kbd> dismiss {ATTENTION_DISMISS_DAYS}d</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>⌫</Kbd> delete</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>esc</Kbd> clear filter</span>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={active ? 'Nothing of that kind' : 'Nothing is falling through'}
          description={
            active
              ? 'No items in this category right now.'
              : 'No overdue work, no stale decisions, nothing waiting past its date. The Decide queue is counted separately.'
          }
          action={
            active ? (
              <button type="button" onClick={() => setKind(null)} className="text-xs text-primary hover:underline">
                Show everything
              </button>
            ) : undefined
          }
        />
      ) : (
        <Panel className="overflow-hidden">
          <div ref={listRef}>
            {rows.map((row, index) => {
              const kind = attentionKind(row.category)
              const band = urgencyBand(row.urgency)
              const target = attentionDeleteTarget(row.category, row.id)
              const working = busy.has(row.id)
              return (
                <div
                  key={row.id}
                  data-row={index}
                  onMouseEnter={() => setCursor(index)}
                  className={cn(
                    'group relative flex items-start gap-3 px-4 py-3 transition-colors border-l-2 first:rounded-t-xl last:rounded-b-xl',
                    // Only `now` is tinted. When every row is red, red has
                    // stopped signifying (§12) — so `soon` gets the border
                    // alone and `watch` gets nothing.
                    band === 'now' ? 'border-l-critical bg-critical-surface/40'
                      : band === 'soon' ? 'border-l-caution'
                      : 'border-l-transparent',
                    // ⚠ THE CURSOR IS A RING, NOT A BACKGROUND, AND THAT IS NOT
                    // A STYLE CHOICE. `cn()` is tailwind-merge: `bg-accent` and
                    // `bg-critical-surface/40` are the same utility group, so
                    // the later one WINS and the earlier is dropped from the
                    // class string entirely. The most urgent row lost its band
                    // colour at the exact moment you navigated onto it — caught
                    // by the render check counting tinted rows (3 against 4),
                    // and invisible to tsc, the build and a glance.
                    // A ring is a different group and composes.
                    index === cursor && 'ring-2 ring-inset ring-ring/50 z-10',
                    'hover:bg-accent/60',
                    working && 'opacity-60'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip tone={kind.tone}>{kind.label}</Chip>
                      <span className="text-xs text-muted-foreground truncate">{row.project_name}</span>
                    </div>
                    {/* The stretched link: one real anchor per row, covering the
                        whole row, under the action buttons. */}
                    <Link
                      href={attentionHref(row.category, row.project_id)}
                      className="mt-1 block text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                  </div>

                  {/* ⚠ `relative z-10` PUTS THESE ABOVE THE STRETCHED LINK'S
                      OVERLAY. Without it the anchor's ::after sits on top and
                      every press navigates instead of acting — the control
                      would look present and do the wrong thing. */}
                  <div className="relative z-10 flex shrink-0 items-center gap-1">
                    {/* The 0-100 score the engine has always produced and
                        nothing has ever shown. */}
                    <span
                      className={cn(
                        'text-xs tnum mr-1',
                        band === 'now' ? 'text-critical font-semibold' : 'text-muted-foreground'
                      )}
                      title="Urgency, 0–100"
                    >
                      {row.urgency}
                    </span>

                    {/* ⚠ VISIBLE ON HOVER *AND* ON FOCUS, AND ALWAYS BELOW `sm`.
                        §12: a control that only appears on hover does not exist
                        on a phone, and one without `focus-visible:opacity-100`
                        is invisible to a keyboard user. */}
                    <button
                      type="button"
                      onClick={() => onDismiss(row)}
                      disabled={working}
                      title={`Dismiss for ${ATTENTION_DISMISS_DAYS} days`}
                      aria-label={`Dismiss "${row.title}" for ${ATTENTION_DISMISS_DAYS} days`}
                      className="inline-flex size-[2.75rem] items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:size-7 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    >
                      {working ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
                    </button>

                    {target && (
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        disabled={working}
                        title={`Delete this ${target.noun}`}
                        aria-label={`Delete ${target.noun} "${row.title}"`}
                        className="inline-flex size-[2.75rem] items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors outline-none hover:bg-critical-surface hover:text-critical focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:size-7 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}

                    <ArrowRight size={13} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      )}
    </div>
  )
}

/**
 * Open / Dismissed. Only rendered once there is something dismissed to look at
 * — a tab reading "Dismissed 0" is a permanent invitation to an empty screen,
 * and §12's count-gating rule applies to READING a populated list, which this
 * is (the dismiss button itself is never gated, so there is always a way in).
 */
function ViewTabs({
  view,
  onView,
  open,
  quiet,
}: {
  view: 'open' | 'dismissed'
  onView: (view: 'open' | 'dismissed') => void
  open: number
  quiet: number
}) {
  if (quiet === 0 && view === 'open') return null
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onView('open')}
        className={cn(
          'rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          view === 'open' ? 'bg-card text-foreground ring-border' : 'text-muted-foreground ring-transparent hover:text-foreground'
        )}
      >
        Needs you <span className="tnum ml-1">{open}</span>
      </button>
      <button
        type="button"
        onClick={() => onView('dismissed')}
        className={cn(
          'rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          view === 'dismissed' ? 'bg-card text-foreground ring-border' : 'text-muted-foreground ring-transparent hover:text-foreground'
        )}
      >
        Dismissed <span className="tnum ml-1">{quiet}</span>
      </button>
    </div>
  )
}

/** A date a reader can say out loud, with no time of day on it. */
function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
