'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/card'
import type { Project, ProjectStage } from '@/lib/supabase/types'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGE_COLOR, STATUS_BADGE, STATUS_LABELS, formatValue } from '@/lib/utils/constants'
import { pipelineValue, rolledPipelineValue } from '@/lib/records/pipeline-value'

/**
 * The portfolio as a dense, sortable table.
 *
 * ── WHY THIS VIEW EXISTS ────────────────────────────────────────────────────
 * Richard, on a shipped "complete overhaul": *"I am not seeing different button
 * shapes, layouts, etc that make this look more modern and polished."* On
 * layouts he was simply right — the two previous passes moved colour tokens and
 * control styling and never touched how a list is shaped.
 *
 * `/projects` offered a Kanban board and a grouped card list, and both are
 * CARD layouts: one record per tile, four or five facts each, most of a screen
 * spent on padding. Every reference app in the brief — Attio above all, and
 * Domo's own list surfaces — leads with a TABLE: one row per record, every
 * column comparable down the page, fifteen records visible instead of four.
 * That is the actual difference between "an admin panel" and "a BI tool", and
 * no amount of radius or shadow substitutes for it.
 *
 * The board is NOT removed — a bid funnel genuinely is a board, and the drag
 * primitive built on 10-26 lives there. This is a third view, and the default,
 * because scanning the portfolio is the common act and working the funnel is
 * the occasional one.
 *
 * ⚠ VALUE IS `rolledPipelineValue`, NEVER THE COLUMN. A program's figure is
 * the sum of its leaves; reading `estimated_value` straight off the row is the
 * double-count `pipeline-value.ts` exists to prevent, and a new reader of that
 * module is exactly where it comes back.
 */

type SortKey = 'name' | 'stage' | 'sector' | 'client' | 'value' | 'updated'
type Dir = 'asc' | 'desc'

const COLUMNS: Array<{
  key: SortKey
  label: string
  /** Right-aligned, tabular — money and dates. */
  numeric?: boolean
  className?: string
}> = [
  { key: 'name', label: 'Project' },
  { key: 'stage', label: 'Stage', className: 'w-28 hidden md:table-cell' },
  { key: 'sector', label: 'Sector', className: 'w-28 hidden lg:table-cell' },
  { key: 'client', label: 'Client', className: 'w-56 hidden xl:table-cell' },
  { key: 'value', label: 'Value', numeric: true, className: 'w-28' },
  { key: 'updated', label: 'Updated', numeric: true, className: 'w-24 hidden sm:table-cell' },
]

function relativeDays(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`
}

export default function ProjectsTable({
  projects,
  allProjects,
  isDimmed,
}: {
  /** The rows to show, already filtered/ranked by the parent. */
  projects: Project[]
  /** The whole set, so a program can roll its value up from leaves not shown. */
  allProjects: Project[]
  /** Search ranking: a non-match stays visible but recedes (never hidden). */
  isDimmed?: (id: string) => boolean
}) {
  const [sort, setSort] = useState<SortKey>('updated')
  const [dir, setDir] = useState<Dir>('desc')

  function toggle(key: SortKey) {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      // Money and dates are far more useful largest-first on the first click.
      setDir(key === 'value' || key === 'updated' ? 'desc' : 'asc')
    }
  }

  const rows = useMemo(() => {
    const valueOf = (p: Project) => rolledPipelineValue(p, allProjects).amount ?? -1
    const by: Record<SortKey, (p: Project) => string | number> = {
      name: (p) => p.name.toLowerCase(),
      stage: (p) => STAGE_LABELS[p.stage as ProjectStage] ?? '',
      sector: (p) => p.sector ?? '',
      client: (p) => (p.client_entity ?? '').toLowerCase(),
      value: valueOf,
      updated: (p) => (p.updated_at ? new Date(p.updated_at).getTime() : 0),
    }
    const pick = by[sort]
    return [...projects].sort((a, b) => {
      const av = pick(a)
      const bv = pick(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return dir === 'asc' ? cmp : -cmp
    })
  }, [projects, allProjects, sort, dir])

  return (
    // `Panel`, not a hand-rolled shell — `conventions.test.ts` caught this on
    // the first run, which is the second time in one session that ratchet has
    // stopped a NEW primitive starting the 228th copy of the card.
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm min-w-[52rem]">
          {/*
            ⚠ THE HEADER STICKS TO THE SCROLL CONTAINER, NOT THE PAGE. The app
            scrolls in `<main>`, so `top-0` here pins the row to the top of the
            table's own box as the page moves — which is what makes a long list
            readable and is the whole reason a table beats a card grid here.
          */}
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
            <tr className="border-b border-border">
              {COLUMNS.map((c) => {
                const active = sort === c.key
                const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn('px-3 py-2 text-left font-medium', c.className)}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn(
                        'group inline-flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 label-caps transition-colors',
                        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                        c.numeric && 'w-full justify-end'
                      )}
                    >
                      {c.label}
                      <Icon
                        size={12}
                        className={cn('transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60')}
                      />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const value = rolledPipelineValue(p, allProjects)
              const status = p.status ?? 'active'
              const dim = isDimmed?.(p.id)
              return (
                <tr
                  key={p.id}
                  className={cn(
                    'group border-b border-border/60 last:border-0 transition-colors hover:bg-accent/60',
                    dim && 'opacity-40'
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* A stage dot carries the funnel position into every row,
                          so the board's one real signal survives the layout. */}
                      <span
                        aria-hidden
                        className={cn('size-1.5 shrink-0 rounded-full', STAGE_COLOR[p.stage as ProjectStage] ?? 'bg-muted-foreground')}
                      />
                      <Link
                        href={`/projects/${p.id}`}
                        className="min-w-0 font-medium text-foreground hover:text-primary transition-colors"
                      >
                        <span className="block truncate">{p.name}</span>
                      </Link>
                      {status !== 'active' && (
                        <Chip tone={STATUS_BADGE[status]} className="shrink-0 whitespace-nowrap">
                          {STATUS_LABELS[status]}
                        </Chip>
                      )}
                    </div>
                    {/* Below md the hidden columns have to go somewhere, or a
                        phone shows a list of bare names. */}
                    <p className="mt-0.5 truncate pl-4 text-xs text-muted-foreground md:hidden">
                      {[STAGE_LABELS[p.stage as ProjectStage], p.client_entity, p.location].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className="block truncate text-muted-foreground">{STAGE_LABELS[p.stage as ProjectStage] ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 hidden lg:table-cell">
                    {p.sector ? (
                      <Chip tone={SECTOR_BADGE[p.sector]} className="whitespace-nowrap">{SECTOR_SHORT[p.sector]}</Chip>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 hidden xl:table-cell">
                    <span className="block truncate text-muted-foreground">{p.client_entity || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {value.amount != null ? (
                      <span className="tnum font-medium text-foreground" title={value.hint}>
                        {formatValue(value.amount)}
                        {/* A program's figure is its children's. Say so, or the
                            number argues with the one on its sub-projects. */}
                        {value.rolled && <span className="ml-1 text-xs font-normal text-muted-foreground">rolled</span>}
                      </span>
                    ) : (
                      /*
                        ⚠ AN EM DASH HERE, AND "no value" ON THE CARDS, AND
                        BOTH ARE RIGHT. §12 says a bare em dash at a value's
                        own WEIGHT reads as a failed render, which is why this
                        column said the words. But in an ALIGNED COLUMN those
                        words repeat on every unpriced row — 19 of 20 projects
                        here — so the most repeated element in the table was a
                        non-answer that read as a broken import.
                        A table resolves it: the dash is muted rather than at
                        the value's weight, the column has a named header, and
                        the CLIENT column beside it already renders absence
                        exactly this way. Two adjacent columns answering the
                        same question differently is the worse failure.
                        The cards keep the words, because a card has no column
                        to be read down and no neighbour to agree with.
                      */
                      <span className="text-muted-foreground" aria-label="no value">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell">
                    <span className="tnum text-xs text-muted-foreground">{relativeDays(p.updated_at)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export { pipelineValue }
