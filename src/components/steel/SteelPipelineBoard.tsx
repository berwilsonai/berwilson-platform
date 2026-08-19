'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  LayoutGrid,
  List,
  Ruler,
  CalendarClock,
  TriangleAlert,
  CircleAlert,
  CircleDashed,
  Clock,
  GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStoredState } from '@/hooks/use-stored-state'
import type { SteelDeal } from '@/lib/supabase/types'
import { formatValue, formatDate } from '@/lib/utils/constants'
import { isPastDate } from '@/lib/utils/investors'
import { hashedAvatarClasses, nameInitials } from '@/lib/utils/avatar'
import {
  steelStage,
  isOpenStage,
  formatSqft,
  leadSourceLabel,
  leadSourceBadge,
  STEEL_PIPELINE,
  STEEL_STAGE_LABELS,
  STEEL_STAGE_BADGE,
  STEEL_STAGE_BORDER,
  type SteelStage,
} from '@/lib/utils/steel'
import SteelDealsClient, { type SteelDealCardData } from '@/components/steel/SteelDealsClient'

/** Days without any update before an open deal is flagged "stale". */
const STALE_DAYS = 14

/** Kanban columns: the full funnel plus the Lost off-ramp (drag a dead deal here). */
const BOARD_STAGES: SteelStage[] = [...STEEL_PIPELINE, 'lost']

type Scope = 'mine' | 'all'
type View = 'board' | 'list'
type Attn = '' | 'overdue' | 'no_next' | 'stale'

interface SteelPipelineBoardProps {
  items: SteelDealCardData[]
  salespeople: { id: string; name: string }[]
  /** The viewer's team_member id, when their login is linked (enables "My Pipeline"). */
  myMemberId: string | null
  /** Commission owed / projected to the viewer (server-computed; viewer-fixed). */
  myOwed: number
  myProjected: number
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return 0
  return Math.floor((Date.now() - then) / 86_400_000)
}

const isOverdue = (d: SteelDeal) => isOpenStage(d.stage) && isPastDate(d.next_step_date)
const isNoNext = (d: SteelDeal) => isOpenStage(d.stage) && !d.next_step && !d.next_step_date
const isStale = (d: SteelDeal) => isOpenStage(d.stage) && daysSince(d.updated_at) >= STALE_DAYS

export default function SteelPipelineBoard({
  items: initialItems,
  salespeople,
  myMemberId,
  myOwed,
  myProjected,
}: SteelPipelineBoardProps) {
  const router = useRouter()
  const [items, setItems] = useState<SteelDealCardData[]>(initialItems)

  const [scope, setScope] = useStoredState<Scope>('bw.steel.scope', myMemberId ? 'mine' : 'all')
  const [view, setView] = useStoredState<View>('bw.steel.view', 'board')
  const [source, setSource] = useState('')
  const [sales, setSales] = useState('')
  const [attn, setAttn] = useState<Attn>('')

  // drag state (column-level targets only — no manual within-column ordering)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropStage, setDropStage] = useState<SteelStage | null>(null)
  const snapshot = useRef<SteelDealCardData[]>(initialItems)

  const effScope: Scope = myMemberId ? scope : 'all'

  // Lead sources present in the data, for the filter dropdown.
  const sources = useMemo(
    () =>
      [...new Set(items.map((i) => i.deal.lead_source).filter(Boolean) as string[])].sort((a, b) =>
        leadSourceLabel(a).localeCompare(leadSourceLabel(b))
      ),
    [items]
  )

  // Scope → "my book" (deals I'm the salesperson on) or everyone's.
  const scoped = useMemo(
    () =>
      effScope === 'mine' && myMemberId
        ? items.filter((i) => i.deal.salesperson_id === myMemberId)
        : items,
    [items, effScope, myMemberId]
  )

  // Attention counts computed on the scoped set (before the source/sales narrowing
  // so the chips reflect the whole book being viewed).
  const attnStats = useMemo(() => {
    const overdue = new Set<string>()
    const noNext = new Set<string>()
    const stale = new Set<string>()
    for (const { deal } of scoped) {
      if (isOverdue(deal)) overdue.add(deal.id)
      if (isNoNext(deal)) noNext.add(deal.id)
      if (isStale(deal)) stale.add(deal.id)
    }
    const union = new Set<string>([...overdue, ...noNext, ...stale])
    return { overdue, noNext, stale, actionCount: union.size }
  }, [scoped])

  const filtered = useMemo(
    () =>
      scoped.filter(({ deal }) => {
        if (source && deal.lead_source !== source) return false
        if (effScope === 'all' && sales && deal.salesperson_id !== sales) return false
        if (attn === 'overdue' && !attnStats.overdue.has(deal.id)) return false
        if (attn === 'no_next' && !attnStats.noNext.has(deal.id)) return false
        if (attn === 'stale' && !attnStats.stale.has(deal.id)) return false
        return true
      }),
    [scoped, source, sales, effScope, attn, attnStats]
  )

  // Stat band — scope-aware pipeline value + win rate over the scoped set.
  const stats = useMemo(() => {
    let openValue = 0
    let won = 0
    let lost = 0
    for (const { deal } of scoped) {
      if (isOpenStage(deal.stage)) openValue += deal.value ?? 0
      if (deal.stage === 'paid') won += 1
      else if (deal.stage === 'lost') lost += 1
    }
    const decided = won + lost
    return { openValue, winRate: decided ? won / decided : null }
  }, [scoped])

  // Group the filtered deals into stage columns; sort each by soonest action then value.
  const byStage = useMemo(() => {
    const map = {} as Record<SteelStage, SteelDealCardData[]>
    for (const st of BOARD_STAGES) map[st] = []
    for (const item of filtered) map[steelStage(item.deal.stage)].push(item)
    for (const st of BOARD_STAGES) {
      map[st].sort((a, b) => {
        const ak = a.deal.next_step_date ?? '9999-99-99'
        const bk = b.deal.next_step_date ?? '9999-99-99'
        if (ak !== bk) return ak.localeCompare(bk)
        return (b.deal.value ?? 0) - (a.deal.value ?? 0)
      })
    }
    return map
  }, [filtered])

  // ── Drag → advance stage ──────────────────────────────────────────────────
  async function commitStage(id: string, next: SteelStage) {
    const item = items.find((i) => i.deal.id === id)
    if (!item || steelStage(item.deal.stage) === next) return
    snapshot.current = items
    setItems((prev) =>
      prev.map((i) => (i.deal.id === id ? { ...i, deal: { ...i.deal, stage: next } } : i))
    )
    try {
      const res = await fetch(`/api/steel/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Failed to move deal' }))
        throw new Error(error ?? 'Failed to move deal')
      }
      toast.success(`Moved to ${STEEL_STAGE_LABELS[next]}`)
      router.refresh()
    } catch (e) {
      setItems(snapshot.current)
      toast.error(e instanceof Error ? e.message : 'Failed to move deal')
    }
  }

  function handleDrop(stage: SteelStage) {
    if (dragId) commitStage(dragId, stage)
    setDragId(null)
    setDropStage(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const chip = (key: Attn, label: string, count: number, Icon: typeof CircleAlert, tone: string) =>
    count > 0 ? (
      <button
        key={key}
        onClick={() => setAttn((a) => (a === key ? '' : key))}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium ring-1 ring-inset transition-colors',
          attn === key ? tone : 'bg-card text-muted-foreground ring-border hover:text-foreground'
        )}
      >
        <Icon size={13} className="shrink-0" />
        {count} {label}
      </button>
    ) : null

  const selectClass =
    'h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="space-y-4">
      {/* Stat band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={effScope === 'mine' ? 'My open pipeline' : 'Open pipeline'} value={formatValue(stats.openValue)} sub={`${scoped.filter((i) => isOpenStage(i.deal.stage)).length} open deals`} />
        <Stat
          label="Win rate"
          value={stats.winRate == null ? '—' : `${Math.round(stats.winRate * 100)}%`}
          sub="Paid ÷ decided"
        />
        {myMemberId ? (
          <>
            <Stat label="Commission owed" value={formatValue(myOwed)} tone="amber" sub="Collected, awaiting payout" />
            <Stat label="Projected" value={formatValue(myProjected)} tone="emerald" sub="If open deals close" />
          </>
        ) : (
          <>
            <Stat label="Deals" value={String(scoped.length)} sub="In this view" />
            <Stat label="Need action" value={String(attnStats.actionCount)} tone={attnStats.actionCount ? 'amber' : undefined} sub="Overdue / stale / no next step" />
          </>
        )}
      </div>

      {/* Needs-attention chips */}
      {(attnStats.overdue.size > 0 || attnStats.noNext.size > 0 || attnStats.stale.size > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label-caps text-muted-foreground mr-0.5">Needs attention</span>
          {chip('overdue', 'overdue', attnStats.overdue.size, CircleAlert, 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30')}
          {chip('no_next', 'no next step', attnStats.noNext.size, CircleDashed, 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30')}
          {chip('stale', `stale (>${STALE_DAYS}d)`, attnStats.stale.size, Clock, 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25')}
          {attn && (
            <button onClick={() => setAttn('')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Toolbar: scope + filters (left), view toggle (right) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {myMemberId && (
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as Scope)}
              options={[
                { value: 'mine', label: 'My Pipeline' },
                { value: 'all', label: 'All Deals' },
              ]}
            />
          )}
          <select value={source} onChange={(e) => setSource(e.target.value)} className={selectClass}>
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {leadSourceLabel(s)}
              </option>
            ))}
          </select>
          {effScope === 'all' && (
            <select value={sales} onChange={(e) => setSales(e.target.value)} className={selectClass}>
              <option value="">All Salespeople</option>
              {salespeople.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <span className="text-xs text-muted-foreground">
            {filtered.length} deal{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        <Segmented
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { value: 'board', label: 'Board', icon: LayoutGrid },
            { value: 'list', label: 'List', icon: List },
          ]}
        />
      </div>

      {/* Board / List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No deals match this view.</p>
        </div>
      ) : view === 'list' ? (
        <SteelDealsClient items={filtered} />
      ) : (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div className="flex gap-3 min-w-max">
            {BOARD_STAGES.map((st) => {
              const list = byStage[st]
              const colValue = list.reduce((a, i) => a + (i.deal.value ?? 0), 0)
              const muted = st === 'paid' || st === 'lost'
              return (
                <div
                  key={st}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    setDropStage(st)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDrop(st)
                  }}
                  className={cn(
                    'w-[15rem] shrink-0 rounded-xl border p-2.5 transition-colors',
                    dragId && dropStage === st
                      ? 'border-primary/60 bg-primary/5'
                      : muted
                        ? 'border-border bg-muted/20'
                        : 'border-border bg-card/40'
                  )}
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-1 pb-2 mb-1 border-b border-border/60">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                        STEEL_STAGE_BADGE[st]
                      )}
                    >
                      {STEEL_STAGE_LABELS[st]}
                    </span>
                    <span className="text-xs text-muted-foreground tnum ml-auto">{list.length}</span>
                  </div>
                  <p className="px-1 pb-2 text-[11px] text-muted-foreground tnum">
                    {colValue > 0 ? formatValue(colValue) : '—'}
                  </p>

                  {/* Cards */}
                  <div className="space-y-2 min-h-[3rem]">
                    {list.map((item) => (
                      <PipelineCard
                        key={item.deal.id}
                        item={item}
                        showSalesperson={effScope === 'all'}
                        dragging={dragId === item.deal.id}
                        onDragStart={() => setDragId(item.deal.id)}
                        onDragEnd={() => {
                          setDragId(null)
                          setDropStage(null)
                        }}
                      />
                    ))}
                    {list.length === 0 && (
                      <p className="px-1 py-3 text-[11px] text-muted-foreground/70">—</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Drag a card to another column to advance its stage. On a phone, open a deal to change its stage.
      </p>
    </div>
  )
}

// ─── Compact board card ─────────────────────────────────────────────────────

function PipelineCard({
  item,
  showSalesperson,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  item: SteelDealCardData
  showSalesperson: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const { deal, salesperson } = item
  const s = steelStage(deal.stage)
  const overdue = isOverdue(deal)

  return (
    <Link
      href={`/steel/${deal.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', deal.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group block rounded-lg border border-border border-l-[3px] bg-card p-2.5 elev-1 cursor-grab active:cursor-grabbing transition-colors hover:border-primary/40',
        STEEL_STAGE_BORDER[s],
        dragging && 'opacity-40'
      )}
    >
      <div className="flex items-start gap-1.5">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
          {deal.name}
        </h3>
        <GripVertical size={13} className="hidden md:block shrink-0 mt-0.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
      </div>

      {(deal.customer || deal.building_type) && (
        <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
          {[deal.customer, deal.building_type].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        {deal.value != null ? (
          <span className="text-[13px] font-semibold tnum text-foreground">{formatValue(deal.value)}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">No value</span>
        )}
        {deal.square_feet != null && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground tnum">
            <Ruler size={10} className="shrink-0" />
            {formatSqft(deal.square_feet)}
          </span>
        )}
      </div>

      {/* Meta row: source chip + below-floor flag */}
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
            leadSourceBadge(deal.lead_source)
          )}
        >
          {leadSourceLabel(deal.lead_source)}
        </span>
        {deal.pricing_below_floor && (
          <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
            <TriangleAlert size={10} className="shrink-0" />
            Below floor
          </span>
        )}
      </div>

      {showSalesperson && salesperson && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className={cn('inline-flex items-center justify-center size-4 rounded-full text-[8px] font-semibold', hashedAvatarClasses(salesperson))}>
            {nameInitials(salesperson)}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">{salesperson}</span>
        </div>
      )}

      {(deal.next_step || deal.next_step_date) && (
        <div
          className={cn(
            'mt-2 flex items-center gap-1 text-[11px] truncate',
            overdue ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground/80'
          )}
        >
          <CalendarClock size={11} className="shrink-0" />
          <span className="truncate">
            {deal.next_step || `Next step ${formatDate(deal.next_step_date)}`}
            {overdue && ' · overdue'}
          </span>
        </div>
      )}
    </Link>
  )
}

// ─── Small UI bits ──────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'amber' | 'emerald'
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'emerald'
        ? 'text-emerald-600 dark:text-emerald-400'
        : ''
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tnum mt-0.5 ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: typeof LayoutGrid }[]
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-input bg-background p-0.5">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium transition-colors',
            value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {Icon && <Icon size={13} />}
          {label}
        </button>
      ))}
    </div>
  )
}
