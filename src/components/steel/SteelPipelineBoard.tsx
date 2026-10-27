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
  UserRoundX,
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
import { Segmented } from '@/components/ui/segmented'
import {
  useBoardDnd,
  BoardLiveRegion,
  DragHandle,
  BoardHint,
  type Lane,
  type BoardDnd,
} from '@/components/ui/board'
import { FIELD_CONTROL_SM_CLASS } from '@/lib/utils/field-classes'

/** Days without any update before an open deal is flagged "stale". */
const STALE_DAYS = 14

/** Kanban columns: the full funnel plus the Lost off-ramp (drag a dead deal here). */
const BOARD_STAGES: SteelStage[] = [...STEEL_PIPELINE, 'lost']

type Scope = 'mine' | 'all'
type View = 'board' | 'list'
type Attn = '' | 'overdue' | 'no_next' | 'stale' | 'unowned'

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

  // Deals with no salesperson at all. Counted over EVERY deal, never the
  // scoped set: an unowned deal is in nobody's book, so "My Pipeline" — the
  // default scope — filters it out of existence. A lead promoted to steel
  // without an estimator was created, was correct, and was visible to no one.
  // Scoping is deliberately bypassed when this chip is on, or the chip could
  // only ever reveal what the scope had already discarded.
  const unowned = useMemo(
    () => new Set(items.filter((i) => !i.deal.salesperson_id).map((i) => i.deal.id)),
    [items]
  )

  // Scope → "my book" (deals I'm the salesperson on) or everyone's.
  const scoped = useMemo(() => {
    if (attn === 'unowned') return items.filter((i) => unowned.has(i.deal.id))
    return effScope === 'mine' && myMemberId
      ? items.filter((i) => i.deal.salesperson_id === myMemberId)
      : items
  }, [items, effScope, myMemberId, attn, unowned])

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
        // 'unowned' is applied in `scoped`, above — it has to outrank the scope.
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
  // ─── Drag a deal between stages ───────────────────────────────────────────
  /*
    ⚠ THIS BOARD'S DRAG WAS ONE OF THREE HAND-ROLLED COPIES, AND ALL THREE WERE
    POINTER-ONLY. Its own footer used to say so — *"On a phone, open a deal to
    change its stage"* — which made the limitation documentation rather than a
    bug. The shared primitive carries the keyboard and the tap as well, so the
    sentence is gone along with the copy.

    Lanes run over `SteelDeal` rather than `SteelDealCardData`, because the hook
    keys on `id` and the card wrapper has none of its own; the salesperson is
    looked back up when the card renders.
  */
  const lanes: Lane[] = useMemo(
    () => BOARD_STAGES.map((st) => ({ id: st, label: STEEL_STAGE_LABELS[st] })),
    []
  )

  const dnd = useBoardDnd<SteelDeal>({
    lanes,
    items: useMemo(() => filtered.map((i) => i.deal), [filtered]),
    laneOf: (d) => steelStage(d.stage),
    setLane: (d, laneId) => ({ ...d, stage: laneId as SteelStage }),
    titleOf: (d) => d.name,
    /*
      ⚠ reorderable: false, and here it is not even a schema question — the
      order WITHIN a column is derived (next step date, then value), so a
      hand-dragged position would be overwritten by the next sort rather than
      by the next fetch.
    */
    reorderable: false,
    onMove: async (move) => {
      await commitStage(move.itemId, move.toLaneId as SteelStage)
    },
  })

  const byStage = useMemo(() => {
    const map = {} as Record<SteelStage, SteelDealCardData[]>
    for (const st of BOARD_STAGES) map[st] = []
    /*
      ⚠ GROUPS FROM `dnd.preview`, NOT FROM `filtered`. The preview is the
      TENTATIVE arrangement, so the card visibly moves under the cursor and
      under the arrow keys instead of waiting for the PATCH to return. The
      salesperson is looked back up here, because the hook keys on the deal.
    */
    const wrapperById = new Map(filtered.map((i) => [i.deal.id, i]))
    for (const deal of dnd.preview) {
      const wrapper = wrapperById.get(deal.id)
      if (!wrapper) continue
      map[steelStage(deal.stage)].push({ ...wrapper, deal })
    }
    for (const st of BOARD_STAGES) {
      map[st].sort((a, b) => {
        const ak = a.deal.next_step_date ?? '9999-99-99'
        const bk = b.deal.next_step_date ?? '9999-99-99'
        if (ak !== bk) return ak.localeCompare(bk)
        return (b.deal.value ?? 0) - (a.deal.value ?? 0)
      })
    }
    return map
  }, [filtered, dnd.preview])

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
      // ⚠ RETHROWN, NOT SWALLOWED. The board primitive rolls its own optimistic
      // arrangement back on a rejection and announces the failure to a screen
      // reader; swallowing here would leave it announcing a move that did not
      // happen, which is worse than the old silent revert because it is spoken.
      throw e
    }
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

  // `w-auto` out of the shared class on purpose: these sit in a `flex-wrap`
  // row, and the shared control is `w-full` because most controls fill a form
  // grid cell. A 100% flex item on a wrapping row stacks one per line.
  const selectClass = cn(FIELD_CONTROL_SM_CLASS, 'w-auto')

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
      {(attnStats.overdue.size > 0 ||
        attnStats.noNext.size > 0 ||
        attnStats.stale.size > 0 ||
        unowned.size > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="label-caps text-muted-foreground mr-0.5">Needs attention</span>
          {chip('overdue', 'overdue', attnStats.overdue.size, CircleAlert, 'bg-critical-surface text-critical ring-critical-edge')}
          {chip('no_next', 'no next step', attnStats.noNext.size, CircleDashed, 'bg-caution-surface text-caution ring-caution-edge')}
          {chip('stale', `stale (>${STALE_DAYS}d)`, attnStats.stale.size, Clock, 'bg-muted text-foreground ring-border dark:bg-muted-foreground/15 dark:text-muted-foreground dark:ring-border/25')}
          {chip('unowned', 'unassigned', unowned.size, UserRoundX, 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30')}
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
              label="Deal scope"
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
          label="Pipeline view"
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
              /*
                ⚠ AN EMPTY COLUMN COLLAPSES, same idiom as `OpportunityBoard`.
                Measured 2026-10-27: five of the six stages here hold nothing,
                so at a fixed 15rem each the board spent 1,200 of its 1,451px
                on columns with no cards in them — a board that is 80% the
                absence of deals. It reopens while a drag is in flight, because
                a collapsed column still has to be able to RECEIVE one; that is
                the whole reason the width is a transition rather than a
                conditional render.
              */
              const empty = list.length === 0
              return (
                <div
                  key={st}
                  {...dnd.laneProps(st)}
                  className={cn(
                    'shrink-0 rounded-xl border transition-all',
                    empty && !dnd.dragging ? 'w-[3rem] p-1.5' : 'p-2.5',
                    empty ? (dnd.dragging ? 'w-[11rem]' : 'w-[3rem]') : 'w-[15rem]',
                    muted ? 'border-border bg-muted/20' : 'border-border bg-card/40',
                    /*
                      ⚠ WAS `border-primary/60 bg-primary/5` IN PLACE OF THE
                      RESTING `bg-*`, WHICH IS THE TAILWIND-MERGE TRAP §12
                      DESCRIBES — the drop tint and the muted/normal column
                      background were in one group, so the branch had to
                      re-state every resting style to avoid losing it. A ring
                      is a different group: the column keeps its own background
                      and gains an edge.
                    */
                    dnd.isDropTarget(st) && 'ring-2 ring-primary border-primary/60'
                  )}
                >
                  {/*
                    ⚠ A COLLAPSED COLUMN TURNS ITS LABEL, it does not shrink
                    it. The first attempt kept the horizontal chip at 6rem and
                    produced "Order Place" and "Frame Asse" — a column whose
                    only remaining content was an unreadable word, which is
                    worse than the empty column it replaced. Rotated, the whole
                    stage name fits in a 3rem rail and the board gets 12rem
                    back per empty stage.
                  */}
                  {empty && !dnd.dragging ? (
                    /*
                      ⚠ THE WRAPPER IS HORIZONTAL AND THE SPAN IS VERTICAL, and
                      that split is the point. `items-center` centres along the
                      INLINE axis, so putting `writing-mode: vertical-rl` on the
                      same element that does the centring flips the axis and
                      drops the label to the foot of a full-height rail. The
                      wrapper keeps normal writing mode and centres; only the
                      text turns. It also keeps the chip's fill around the
                      WORD rather than down the whole column, which at seven
                      stages would be seven full-height bands of colour.
                    */
                    <div className="flex h-full justify-center pt-1">
                      <span
                        className={cn(
                          'whitespace-nowrap rounded px-1 py-2 text-[11px] font-medium ring-1 ring-inset [writing-mode:vertical-rl]',
                          STEEL_STAGE_BADGE[st]
                        )}
                      >
                        {STEEL_STAGE_LABELS[st]}
                      </span>
                    </div>
                  ) : (
                  <>
                  {/* Column header — name, count, and the aggregate, which is
                      the main reason to look at a board at all. */}
                  <div className="mb-1 flex min-w-0 items-center gap-2 border-b border-border/60 px-1 pb-2">
                    <span
                      className={cn(
                        'inline-flex min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                        STEEL_STAGE_BADGE[st]
                      )}
                    >
                      {STEEL_STAGE_LABELS[st]}
                    </span>
                    {!empty && (
                      <span className="tnum ml-auto text-xs text-muted-foreground">{list.length}</span>
                    )}
                  </div>
                  {/* ⚠ OMITTED WHEN THERE IS NOTHING TO TOTAL, not rendered as
                      a dash. A collapsed column is already saying "nothing
                      here"; an em dash under it is a second, quieter way of
                      saying the same thing and reads as a failed render (§12). */}
                  {colValue > 0 && (
                    <p className="tnum px-1 pb-2 text-[11px] text-muted-foreground">
                      {formatValue(colValue)}
                    </p>
                  )}

                  {/* Cards */}
                  <div className={cn('space-y-2', !empty && 'min-h-[3rem]')}>
                    {list.map((item, i) => (
                      <PipelineCard
                        key={item.deal.id}
                        item={item}
                        showSalesperson={effScope === 'all'}
                        dnd={dnd}
                        laneId={st}
                        index={i}
                      />
                    ))}
                  </div>
                  </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <BoardLiveRegion dnd={dnd} />
      {/*
        ⚠ THIS USED TO READ "On a phone, open a deal to change its stage" — a
        sentence that documented the hand-rolled drag's pointer-only limitation
        rather than fixing it. The shared primitive carries the tap and the
        keyboard, so the limitation and the sentence both went.
      */}
      <BoardHint dnd={dnd} noun="deal" />
    </div>
  )
}

// ─── Compact board card ─────────────────────────────────────────────────────

function PipelineCard({
  item,
  showSalesperson,
  dnd,
  laneId,
  index,
}: {
  item: SteelDealCardData
  showSalesperson: boolean
  dnd: BoardDnd<SteelDeal>
  laneId: SteelStage
  index: number
}) {
  const { deal, salesperson } = item
  const s = steelStage(deal.stage)
  const overdue = isOverdue(deal)
  const held = dnd.draggingId === deal.id

  /*
    ⚠ THE CARD IS NOW A WRAPPER AROUND THE LINK, NOT THE LINK ITSELF. The drag
    handle is a <button>, and a <button> inside an <a> fires BOTH (§12) — the
    trap that forced /attention's rows from Link to div. Making the anchor a
    sibling keeps the whole card clickable while the handle stays operable by a
    keyboard and a thumb.
  */
  return (
    <div
      {...dnd.cardProps(deal.id, laneId, index)}
      className={cn('relative', held && 'opacity-40')}
    >
    <Link
      href={`/steel/${deal.id}`}
      className={cn(
        'group block rounded-lg border border-border border-l-[3px] bg-card p-2.5 elev-1 cursor-grab active:cursor-grabbing transition-colors hover:border-primary/40',
        STEEL_STAGE_BORDER[s]
      )}
    >
      <div className="flex items-start gap-1.5">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
          {deal.name}
        </h3>
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
          <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-caution-surface text-caution ring-caution-edge">
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
            overdue ? 'text-caution font-medium' : 'text-muted-foreground/80'
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

      {/* A SIBLING of the Link, never a descendant (§12). */}
      <DragHandle
        dnd={dnd}
        id={deal.id}
        laneId={laneId}
        index={index}
        className="top-auto bottom-1 right-1 md:bottom-1.5 md:right-1.5"
      />
    </div>
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
      ? 'text-caution'
      : tone === 'emerald'
        ? 'text-positive'
        : ''
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 elev-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tnum mt-0.5 ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

