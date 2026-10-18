'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CircleCheck } from 'lucide-react'

import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Kbd } from '@/components/ui/kbd'
import EmptyState from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import {
  ATTENTION_KINDS,
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

/**
 * The attention list, with no knowledge of the URL or the router.
 *
 * ⚠ SPLIT OUT SO IT CAN BE RENDERED IN A TEST. `useSearchParams` and
 * `useRouter` throw "invariant expected app router to be mounted" outside a
 * Next request, so a component that reads them cannot be exercised by
 * `renderToStaticMarkup` — and §12 is explicit that a listed route is not an
 * answering one and a curl behind auth cannot tell you which. Taking the active
 * filter as a prop and the two navigations as callbacks makes the whole of what
 * a reader sees verifiable; `AttentionClient` is the thin wrapper that supplies
 * them from the URL.
 *
 * The original reason for the surface:
 *
 * `src/lib/attention.ts` has scored ten categories 0–100 since it was written
 * and was consumed by exactly three things: an API route, the sidebar badge,
 * and an agent tool. Nothing ever showed a reader the ranking, and the
 * dashboard rail — the only place any of it surfaced — truncated six of its
 * eight sections at six items with no overflow link. **There was no way in the
 * product to see attention item number seven.**
 *
 * It copies `/decide`'s idioms on purpose, because that surface is the quality
 * bar in this app: chips derived from the registry rather than hand-listed,
 * filter state in the URL so a view is a link, a keyboard model that is STATED
 * rather than discovered, and an empty state that says you are done.
 */
export default function AttentionList({
  items,
  active,
  onFilter,
  onOpen,
}: {
  items: AttentionRow[]
  /** The category being filtered to, or null for everything. */
  active: string | null
  onFilter: (kind: string | null) => void
  onOpen: (href: string) => void
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
  */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(rows.length - 1, c + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter') {
        const row = rows[cursor]
        if (row) onOpen(attentionHref(row.category, row.project_id))
      } else if (e.key === 'Escape') {
        if (active) setKind(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cursor, active, onFilter, onOpen])

  // Keep the cursor row in view without yanking the page around it.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  return (
    <div className="space-y-4">
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
              return (
                <Link
                  key={row.id}
                  href={attentionHref(row.category, row.project_id)}
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
                    'hover:bg-accent/60'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Chip tone={kind.tone}>{kind.label}</Chip>
                      <span className="text-xs text-muted-foreground truncate">{row.project_name}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{row.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {/* The 0-100 score the engine has always produced and
                        nothing has ever shown. */}
                    <span
                      className={cn(
                        'text-xs tnum',
                        band === 'now' ? 'text-critical font-semibold' : 'text-muted-foreground'
                      )}
                      title="Urgency, 0–100"
                    >
                      {row.urgency}
                    </span>
                    <ArrowRight size={13} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </div>
                </Link>
              )
            })}
          </div>
        </Panel>
      )}
    </div>
  )
}
