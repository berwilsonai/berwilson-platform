'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2, Layers, FolderOpen, Search, X, ChevronDown, GitBranch, Kanban, Rows3, SlidersHorizontal } from 'lucide-react'
import ProjectCard, { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import ProjectsTable from '@/components/projects/ProjectsTable'
import type { Project, ProjectStage } from '@/lib/supabase/types'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { useStoredState } from '@/hooks/use-stored-state'
import {
  coverageNote,
  leafRecords,
  pipelineTotal,
  pipelineValue,
  rolledPipelineValue,
} from '@/lib/records/pipeline-value'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'
import { useBoardDnd, BoardLiveRegion, DragHandle, BoardHint, type Lane } from '@/components/ui/board'
import type { BoardDnd } from '@/components/ui/board'
import {
  STATUS_BADGE, STATUS_LABELS, formatValue, weightedValue,
  STAGES, STAGE_LABELS, STAGE_BADGE, STAGE_COLOR,
} from '@/lib/utils/constants'

/**
 * ⚠ `table` ADDED 2026-10-27 AND MADE THE DEFAULT. The two existing views are
 * both CARD layouts — a Kanban of tiles and a grouped card list — and that is
 * the "layout" half of the overhaul that two previous passes never touched.
 * See `ProjectsTable` for why a table is the difference between an admin panel
 * and a BI tool. The board stays: a bid funnel genuinely is a board.
 */
type ViewMode = 'program' | 'pipeline' | 'table'

interface ProjectsClientProps {
  projects: Project[]
  /** Active stage filter from the URL. When set, the pipeline board shows only this stage's column. */
  stageFilter?: string
}

function ProgramBanner({
  program,
  allProjects,
  childCount,
  isCollapsed,
  onToggle,
}: {
  program: Project
  /** The whole set, so the banner can roll the value up from the leaves. */
  allProjects: Project[]
  childCount: number
  isCollapsed: boolean
  onToggle: () => void
}) {
  const status = program.status ?? 'active'
  // ⚠ THE SUM OF THE WORK INSIDE, NOT THE PROGRAM'S OWN FIGURE. This showed
  // `pipelineValue(program)` — a figure that is either blank (the usual case,
  // reading as an unpriced program above priced children) or double-counted
  // against the sub-projects listed directly beneath it.
  const value = rolledPipelineValue(program, allProjects)

  return (
    <div className="flex items-stretch gap-0 rounded-lg border border-border bg-card elev-1 overflow-hidden">
      <Link
        href={`/projects/${program.id}`}
        className="group flex items-center gap-4 px-5 py-4 flex-1 min-w-0 hover:bg-accent/50 transition-colors"
      >
        {/* Icon */}
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted text-muted-foreground shrink-0">
          <Layers size={18} />
        </div>

        {/* Name + entity */}
        <div className="min-w-0 flex-1">
          <p className="label-caps text-muted-foreground mb-0.5">
            Program
          </p>
          <h2 className="text-sm font-semibold text-foreground leading-tight group-hover:text-primary transition-colors truncate">
            {program.name}
          </h2>
          {program.client_entity && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{program.client_entity}</p>
          )}
        </div>

        {/* Right side: badges + value + count */}
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={cn(
              'hidden sm:inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
              SECTOR_BADGE[program.sector]
            )}
          >
            {SECTOR_SHORT[program.sector]}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
              STATUS_BADGE[status]
            )}
          >
            {STATUS_LABELS[status]}
          </span>
          <span
            className="text-sm font-bold tnum text-foreground"
            title={value.hint}
          >
            {value.amount != null ? formatValue(value.amount) : 'Not set'}
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground border border-border rounded px-2 py-0.5 bg-background">
            <FolderOpen size={11} />
            {childCount} sub-project{childCount !== 1 ? 's' : ''}
          </span>
        </div>
      </Link>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        title={isCollapsed ? 'Expand sub-projects' : 'Collapse sub-projects'}
        className="flex items-center justify-center w-10 border-l border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
      >
        <ChevronDown
          size={16}
          className={cn('transition-transform duration-200', isCollapsed ? '-rotate-90' : 'rotate-0')}
        />
      </button>
    </div>
  )
}

export default function ProjectsClient({ projects: initialProjects, stageFilter }: ProjectsClientProps) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  // When a stage filter is active in the URL, restrict the pipeline columns to
  // just that stage so the board doesn't keep rendering every (mostly empty)
  // stage. No filter → show the full funnel.
  // Memoized: `lanes` derives from it, and a fresh array each render would
  // rebuild every drag handler on the board on every pass.
  const stageColumns = useMemo(
    () =>
      (stageFilter && STAGES.includes(stageFilter as ProjectStage)
        ? [stageFilter as ProjectStage]
        : STAGES) as ProjectStage[],
    [stageFilter]
  )
  const [search, setSearch] = useState('')
  /*
    ⚠ THE STORAGE KEY IS NEW ON PURPOSE (`…view.v2`). Everyone who has opened
    this page has `bw.projects.view: 'pipeline'` written in localStorage, so a
    changed DEFAULT would reach nobody who has ever used the application —
    which is precisely how the theme change failed to land this same day. A new
    key is the one way a default actually applies to existing readers.
  */
  const [storedView, setView] = useStoredState<ViewMode>('bw.projects.view.v2', 'table')
  const view: ViewMode =
    storedView === 'program' ? 'program' : storedView === 'pipeline' ? 'pipeline' : 'table'
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set())

  function handleDelete(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  function handleUpdate(id: string, patch: Partial<Project>) {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
  }

  function toggleProgram(id: string) {
    setCollapsedPrograms(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const q = search.trim().toLowerCase()
  const isSearching = q.length > 0

  // Which projects match the search, across every field a user might recall a
  // project by — name, where it is, who it's for, how it's bid, and its
  // descriptive text — plus the parent program's name so a sub-project surfaces
  // when you search the program it belongs to.
  const matchIds = useMemo(() => {
    const ids = new Set<string>()
    if (!q) return ids
    const nameById = new Map(projects.map(p => [p.id, p.name]))
    for (const p of projects) {
      const pp = p as Project & {
        incumbent?: string | null
        capture_lead?: string | null
        win_strategy?: string | null
      }
      const haystack = [
        p.name,
        p.description,
        p.location,
        p.client_entity,
        p.solicitation_number,
        p.contract_type,
        p.delivery_method,
        p.sector,
        p.status,
        p.stage,
        pp.incumbent,
        pp.capture_lead,
        pp.win_strategy,
        p.parent_project_id ? nameById.get(p.parent_project_id) : null,
      ]
      if (haystack.some(field => field?.toLowerCase().includes(q))) ids.add(p.id)
    }
    return ids
  }, [projects, q])

  const matchCount = matchIds.size

  // Rank-and-keep: nothing is hidden while searching. Matches float to the top
  // of every group; the rest stay visible but dimmed below. With no search the
  // original order is preserved.
  const filtered = useMemo(() => {
    if (!isSearching) return projects
    return [...projects].sort((a, b) => {
      const am = matchIds.has(a.id) ? 0 : 1
      const bm = matchIds.has(b.id) ? 0 : 1
      return am - bm
    })
  }, [projects, isSearching, matchIds])

  const isDimmed = (id: string) => isSearching && !matchIds.has(id)

  // Build hierarchy. A sub-project is only nested when its parent program is
  // also in the current (filtered) result set. When a filter excludes the
  // parent, the matching sub-project is shown as a standalone card instead of
  // being silently dropped.
  const presentIds = new Set(filtered.map(p => p.id))
  const childrenOf = new Map<string, Project[]>()
  const parentIds = new Set<string>()

  for (const p of filtered) {
    if (p.parent_project_id && presentIds.has(p.parent_project_id)) {
      const siblings = childrenOf.get(p.parent_project_id) ?? []
      siblings.push(p)
      childrenOf.set(p.parent_project_id, siblings)
      parentIds.add(p.parent_project_id)
    }
  }

  const programs: Project[] = []
  const standalone: Project[] = []
  for (const p of filtered) {
    // Skip sub-projects that are nested under a present parent
    if (p.parent_project_id && presentIds.has(p.parent_project_id)) continue
    if (parentIds.has(p.id)) {
      programs.push(p)
    } else {
      standalone.push(p)
    }
  }

  // Name lookup across ALL projects so a sub-project can show its program name
  // even when the program is filtered out of the current view.
  const nameById = new Map(projects.map(p => [p.id, p.name]))

  // Which projects carry the portfolio's value: every one with no child
  // present. Built over the whole set, once, and used by every total on this
  // screen so they cannot disagree with each other or with the dashboard.
  const leafIds = useMemo(
    () => new Set(leafRecords(projects).map((p) => p.id)),
    [projects]
  )

  /*
    ⚠ THE REFRESH IS ON THE TRAILING EDGE, AND IT IS NOT FOR THIS COMPONENT.
    §12: an optimistic client mutation with no `router.refresh()` leaves every
    server-rendered count lying until the tab is reloaded — a root-layout badge
    is reused across soft navigations, which is how one read 248 against a
    database saying 1. A stage change moves the sidebar's attention badge and
    the portfolio header, both of which render on the server and neither of
    which this component can reach.

    ⚠ It cannot update `projects` here, and that is a known limitation rather
    than an oversight: this state is seeded from props, so a refresh delivers
    new props to the same mounted component and they are ignored. The
    optimistic `handleUpdate` is what keeps THIS screen honest; the refresh is
    what keeps everything outside it honest. (`OpportunitiesClient` avoids the
    whole problem with an overlay of removed ids rather than a copy of the
    list — the better shape, and a bigger change than this session should make
    to a 736-line board.)

    Debounced, because advancing three deals in a row should cost one
    round-trip. Cleared on unmount, or a refresh fires against a page the
    reader has already navigated away from.
  */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 600)
  }, [router])
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  // ─── Drag a deal between stages ───────────────────────────────────────────
  /*
    The lanes are the columns actually on screen, not every stage in the enum:
    a stage filter in the URL narrows the board to one column, and the arrow
    keys must not be able to walk a card into a lane nobody can see.
  */
  const lanes: Lane[] = useMemo(
    () => stageColumns.map((st) => ({ id: st, label: STAGE_LABELS[st] })),
    [stageColumns]
  )

  const dnd = useBoardDnd<Project>({
    lanes,
    items: filtered,
    laneOf: (p) => (p.stage ?? 'pursuit') as ProjectStage,
    setLane: (p, laneId) => ({ ...p, stage: laneId as ProjectStage }),
    titleOf: (p) => p.name,
    /*
      ⚠ reorderable: false, AND IT IS A SCHEMA FACT. `projects` carries no
      order column (verified against database.ts, 2026-10-26), so a
      within-stage reorder could be animated and held optimistically and would
      snap back on the next server render. The hook refuses the gesture rather
      than letting the board tell the reader something untrue.
    */
    reorderable: false,
    onMove: async (move) => {
      // Optimistic first: this component owns `projects`, so writing the stage
      // here is what makes every column total, the weighted figure and the
      // portfolio header move together with the card.
      handleUpdate(move.itemId, { stage: move.toLaneId as ProjectStage })
      const res = await fetch(`/api/projects/${move.itemId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: move.toLaneId }),
      })
      if (!res.ok) {
        // Put it back, then say so. Throwing is what tells the hook to drop its
        // own optimistic arrangement.
        handleUpdate(move.itemId, { stage: move.fromLaneId as ProjectStage })
        const { error } = await res.json().catch(() => ({ error: null }))
        toast.error(error ?? `Could not move to ${STAGE_LABELS[move.toLaneId as ProjectStage]}`)
        throw new Error('stage move failed')
      }
      toast.success(`Moved to ${STAGE_LABELS[move.toLaneId as ProjectStage]}`)
      scheduleRefresh()
    },
  })

  // Stage view: group every matching project (flat) by its stage.
  /*
    ⚠ GROUPS FROM `dnd.preview`, NOT FROM `filtered`. The preview is the
    TENTATIVE arrangement — where the card would land if you dropped it now —
    so the board shows the move under the cursor and under the arrow keys. Read
    from `filtered`, the card would not appear to move until the PATCH came
    back, which on a reasoning model's round-trip reads as the drag failing.
  */
  const byStage = useMemo(() => {
    const groups = new Map<ProjectStage, Project[]>()
    for (const p of dnd.preview) {
      const stage = (p.stage ?? 'pursuit') as ProjectStage
      const arr = groups.get(stage) ?? []
      arr.push(p)
      groups.set(stage, arr)
    }
    return groups
  }, [dnd.preview])

  const viewToggle = (
    <div className="flex items-center gap-2 shrink-0">
      <span className="hidden sm:inline label-caps text-muted-foreground">
        View
      </span>
      {/* Track-and-pill, like every other view switcher — see `Segmented`. */}
      <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5 text-xs">
        <button
          onClick={() => setView('table')}
          title="Every project as one scannable, sortable list"
          aria-pressed={view === 'table'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors',
            view === 'table' ? 'bg-card text-foreground font-medium elev-1' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Rows3 size={12} />
          Table
        </button>
        <button
          onClick={() => setView('pipeline')}
          title="See the whole bid funnel, grouped by stage"
          aria-pressed={view === 'pipeline'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors',
            view === 'pipeline' ? 'bg-card text-foreground font-medium elev-1' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Kanban size={12} />
          Pipeline
        </button>
        <button
          onClick={() => setView('program')}
          title="Group projects under their parent program"
          aria-pressed={view === 'program'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors',
            view === 'program' ? 'bg-card text-foreground font-medium elev-1' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <GitBranch size={12} />
          Programs
        </button>
      </div>
    </div>
  )

  const viewCaption =
    view === 'program'
      ? 'Grouped under each parent program, with standalone projects below.'
      : view === 'table'
        ? 'Every project in one list — click a column to sort.'
        : 'Your bid funnel, grouped by stage — a board on wide screens, a stacked list on mobile.'

  return (
    <div className="space-y-6">
      {/* Search + view toggle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              placeholder="Search by name, location, client, sector, stage…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 pr-8 w-full sm:w-72 rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {viewToggle}
        </div>
        <p className="text-xs text-muted-foreground">{viewCaption}</p>
      </div>

      {isSearching && matchCount === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No projects match &ldquo;{search}&rdquo;
        </div>
      )}

      {/* ─── Table: the default, and the only view that is scannable ───────── */}
      {view === 'table' && filtered.length > 0 && (
        <ProjectsTable projects={filtered} allProjects={projects} isDimmed={isDimmed} />
      )}

      {/* ─── Pipeline (mobile): stage groups stacked top-to-bottom ──────────── */}
      {view === 'pipeline' && filtered.length > 0 && (
        <div className="space-y-6 lg:hidden">
          {/*
            ⚠ AN EMPTY STAGE IS HIDDEN HERE, AND THAT HIDES THE DROP TARGET.
            A stage with no projects is normally noise on a narrow screen — but
            while a card is HELD it is a destination, and the stage a deal most
            often needs to reach is the one that is empty because nothing has
            got there yet. §12: a surface hidden because it is empty is hidden
            exactly when someone needs to fill it. So the filter relaxes for
            the duration of the hold and nothing else changes.
          */}
          {stageColumns
            .filter(s => (byStage.get(s as ProjectStage)?.length ?? 0) > 0 || dnd.keyboard)
            .map(s => {
            const stage = s as ProjectStage
            const items = byStage.get(stage) ?? []
            const target = dnd.keyboard && !items.some(p => p.id === dnd.heldId)
            return (
              <div
                key={stage}
                {...dnd.laneProps(stage)}
                className={cn(
                  'space-y-3 rounded-lg transition-all',
                  // A ring and a dashed outline, never a bg — ProjectCard owns
                  // the backgrounds underneath (§12, tailwind-merge).
                  target && 'ring-2 ring-primary ring-offset-4 ring-offset-background'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('inline-block w-2 h-2 rounded-full', STAGE_COLOR[stage])} />
                  <h2 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h2>
                  <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_BADGE[stage])}>
                    {items.length}
                  </span>
                  {/* The only instruction a thumb gets, and it appears only
                      while it is true. */}
                  {target && (
                    <span className="label-caps text-primary ml-auto">Tap to move here</span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {items.map((project, i) => (
                    <DeletableCard
                      key={project.id}
                      project={project}
                      parentName={project.parent_project_id ? nameById.get(project.parent_project_id) : undefined}
                      highlight={q}
                      dimmed={isDimmed(project.id)}
                      onDeleted={() => handleDelete(project.id)}
                      onUpdated={(patch) => handleUpdate(project.id, patch)}
                      dnd={dnd}
                      laneId={stage}
                      index={i}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="text-xs text-muted-foreground/60 py-3">Nothing in this stage.</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Drag affordances ───────────────────────────────────────────────── */}
      {view === 'pipeline' && filtered.length > 0 && (
        <>
          <BoardLiveRegion dnd={dnd} />
          {/*
            A held card needs a way out that does not require a keyboard. Tapping
            the handle grabs it and tapping a stage drops it — but if neither
            happens, Escape only works while the handle still has focus, so a
            thumb could otherwise be stuck holding a card. This bar is the exit.
          */}
          {dnd.keyboard && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="text-xs text-foreground">
                Holding <strong className="font-semibold">{dnd.preview.find(p => p.id === dnd.heldId)?.name ?? 'a project'}</strong>
                {' '}— choose a stage to move it to.
              </span>
              <button
                type="button"
                onClick={() => dnd.cancelHold()}
                className="ml-auto h-[2.75rem] md:h-7 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {/* ─── Pipeline (desktop): horizontal Kanban board by stage ───────────── */}
      {view === 'pipeline' && filtered.length > 0 && (
        <div className="hidden lg:flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
          {stageColumns.map((s) => {
            const stage = s as ProjectStage
            const items = byStage.get(stage) ?? []
            // Whatever figure each project actually has, with the column
            // saying when it is made of more than one kind. A total that
            // silently mixes a computed Ber Wilson capture with a hand-entered
            // estimate is neither quantity.
            //
            // ⚠ LEAVES ONLY, AND THE LEAF SET IS BUILT OVER THE WHOLE BOARD
            // RATHER THAN PER COLUMN. A program and its sub-projects usually
            // sit in DIFFERENT stages, so a per-column leaf test would let the
            // program count in its own column and the children count in theirs
            // — the columns would then total more than the portfolio does, and
            // the two screens would disagree with no way to tell which is
            // right. A program contributes to no column; its work does.
            const colItems = items.filter((p) => leafIds.has(p.id))
            const colTotal = pipelineTotal(colItems)
            const colValue = colTotal.amount
            const colNote = coverageNote(colTotal)
            const colWeighted = colItems.reduce(
              (sum, p) =>
                sum +
                weightedValue(
                  pipelineValue(p).amount,
                  (p as { win_probability?: number | null }).win_probability ?? null
                ),
              0
            )
            const empty = items.length === 0
            return (
              /*
                An empty stage keeps its place but not its width. Award and
                Mobilization held nothing and still took 300px each, squeezing
                the three columns that had all twelve projects into a third of
                the board and pushing the rest off-screen. The stage stays
                visible — a funnel with a missing rung misleads — it just stops
                charging full rent for nothing.
              */
              <div
                key={stage}
                {...dnd.laneProps(stage)}
                className={cn(
                  'flex flex-col shrink-0 rounded-lg transition-all',
                  /*
                    An empty stage is 92px at rest, which is too narrow to drop
                    into reliably — so it opens up while a drag is in flight.
                    The funnel keeps all its rungs either way; it just stops
                    charging full rent for nothing until you need it.
                  */
                  empty ? (dnd.dragging ? 'w-[180px]' : 'w-[92px]') : 'w-[300px]',
                  /*
                    ⚠ A RING, NOT A BACKGROUND. The column already carries
                    `bg-muted/10` on its body and `bg-muted/40` on its header;
                    `cn()` is tailwind-merge, so a `bg-*` here would silently
                    delete one of those rather than composing with it (§12).
                  */
                  dnd.isDropTarget(stage) && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                )}
              >
                {/* Column header */}
                <div
                  className="sticky top-0 z-10 rounded-t-lg border border-b-0 border-border bg-muted/40 backdrop-blur px-3 py-2.5"
                  title={empty ? `${STAGE_LABELS[stage]} — no projects` : undefined}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', STAGE_COLOR[stage])} />
                    <h2 className={cn('font-semibold text-foreground min-w-0 truncate', empty ? 'text-xs' : 'text-sm')}>
                      {STAGE_LABELS[stage]}
                    </h2>
                    {!empty && (
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_BADGE[stage])}>
                        {items.length}
                      </span>
                    )}
                  </div>
                  {/* An empty stage has no total worth stating; "$0" is noise
                      dressed as a figure. */}
                  {!empty && (
                    <div className="mt-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span
                          className="font-semibold tnum text-foreground"
                          title={colNote ? `${colNote} in this stage` : undefined}
                        >
                          {colTotal.estimated > 0 ? formatValue(colValue) : 'Not set'}
                        </span>
                        {colWeighted > 0 && (
                          <span className="tnum text-positive">{formatValue(colWeighted)} wtd</span>
                        )}
                      </div>
                      {colNote && (
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{colNote}</p>
                      )}
                    </div>
                  )}
                </div>
                {/* Column body */}
                <div className="flex-1 space-y-3 rounded-b-lg border border-t-0 border-border bg-muted/10 p-2 min-h-[120px]">
                  {empty ? (
                    <p className="text-xs text-muted-foreground/50 text-center py-6">—</p>
                  ) : (
                    items.map((project, i) => (
                      <DeletableCard
                        key={project.id}
                        project={project}
                        parentName={project.parent_project_id ? nameById.get(project.parent_project_id) : undefined}
                        highlight={q}
                        dimmed={isDimmed(project.id)}
                        onDeleted={() => handleDelete(project.id)}
                        onUpdated={(patch) => handleUpdate(project.id, patch)}
                        dnd={dnd}
                        laneId={stage}
                        index={i}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {view === 'pipeline' && filtered.length > 0 && (
        <BoardHint dnd={dnd} noun="project" className="hidden lg:block -mt-2" />
      )}

      {/* ─── Program view: grouped by program hierarchy ────────────────────── */}
      {/* Programs with children */}
      {view === 'program' && programs.map(parent => {
        const children = childrenOf.get(parent.id) ?? []
        const isCollapsed = collapsedPrograms.has(parent.id)
        return (
          <div key={parent.id} className="space-y-3">
            <ProgramBanner
              program={parent}
              allProjects={projects}
              childCount={children.length}
              isCollapsed={isCollapsed}
              onToggle={() => toggleProgram(parent.id)}
            />
            {!isCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-5 border-l-2 border-border ml-4">
                {children.map(child => (
                  <DeletableCard
                    key={child.id}
                    project={child}
                    parentName={parent.name}
                    highlight={q}
                    dimmed={isDimmed(child.id)}
                    onDeleted={() => handleDelete(child.id)}
                    onUpdated={(patch) => handleUpdate(child.id, patch)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Divider between programs and standalone */}
      {view === 'program' && programs.length > 0 && standalone.length > 0 && (
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="label-caps text-muted-foreground">
            Independent Projects
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      {/* Standalone projects */}
      {view === 'program' && standalone.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {standalone.map(project => (
            <DeletableCard
              key={project.id}
              project={project}
              highlight={q}
              dimmed={isDimmed(project.id)}
              onDeleted={() => handleDelete(project.id)}
              onUpdated={(patch) => handleUpdate(project.id, patch)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DeletableCard({
  project,
  counts,
  parentName,
  highlight,
  dimmed,
  onDeleted,
  onUpdated,
  dnd,
  laneId,
  index,
}: {
  project: Project
  counts?: ProjectCardCounts
  parentName?: string
  highlight?: string
  dimmed?: boolean
  onDeleted: () => void
  onUpdated?: (patch: Partial<Project>) => void
  /** Present only on the pipeline board — the program view has no lanes. */
  dnd?: BoardDnd<Project>
  laneId?: string
  index?: number
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const p = project as Project & {
    bid_due_date?: string | null
    win_probability?: number | null
  }
  const [bidDue, setBidDue] = useState(p.bid_due_date ?? '')
  const [winProb, setWinProb] = useState(
    p.win_probability != null ? String(p.win_probability) : ''
  )

  async function handleQuickSave(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (winProb !== '') {
      const n = Number(winProb)
      if (isNaN(n) || n < 0 || n > 100) {
        toast.error('Win % must be 0–100')
        return
      }
    }
    setSaving(true)
    try {
      const patch = {
        bid_due_date: bidDue || null,
        win_probability: winProb === '' ? null : Math.round(Number(winProb)),
      }
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        onUpdated?.(patch as Partial<Project>)
        toast.success('Updated')
        setEditing(false)
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Failed to save' }))
        toast.error(error ?? 'Failed to save')
      }
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted()
        toast.success(`${project.name} deleted`)
      } else {
        toast.error('Failed to delete project')
        setDeleting(false)
        setConfirming(false)
      }
    } catch {
      toast.error('Failed to delete project')
      setDeleting(false)
      setConfirming(false)
    }
  }

  const draggable = dnd && laneId !== undefined && index !== undefined
  const held = draggable && dnd.draggingId === project.id

  return (
    <div
      {...(draggable ? dnd.cardProps(project.id, laneId, index) : {})}
      className={cn(
        'relative group/card transition-opacity duration-200',
        dimmed && 'opacity-40 hover:opacity-100',
        /*
          ⚠ THE HELD STYLE IS A RING, NOT A BACKGROUND, AND THAT IS NOT A
          PREFERENCE. `cn()` is tailwind-merge, so two classes in the SAME
          utility group do not compose — the later one silently deletes the
          earlier (§12). ProjectCard already owns this card's `bg-*` and its
          urgency tint; a `bg-*` here would win over one of them and the most
          urgent card would lose its colour at exactly the moment you grabbed
          it. A ring is a different group, so both signals show at once.
        */
        held && 'ring-2 ring-primary rounded-lg opacity-60'
      )}
    >
      {/* Confirmation overlay */}
      {confirming && (
        <div
          className="absolute inset-0 z-10 rounded-lg bg-background/97 border border-destructive/40 flex flex-col items-center justify-center gap-2 p-4"
          onClick={e => { e.preventDefault(); e.stopPropagation() }}
        >
          <p className="text-xs font-medium text-center line-clamp-2">{project.name}</p>
          <p className="text-xs text-muted-foreground text-center">
            Permanently delete this project and all its data?
          </p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(false) }}
              className="h-7 px-3 rounded text-xs border border-input hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 px-3 rounded text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* Quick-edit overlay — set bid date + win % without opening the project */}
      {editing && (
        <div
          className="absolute inset-0 z-10 rounded-lg bg-background/97 border border-primary/40 flex flex-col justify-center gap-3 p-4"
          onClick={e => { e.preventDefault(); e.stopPropagation() }}
        >
          <p className="text-xs font-medium text-center line-clamp-1">{project.name}</p>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Bid Due Date</label>
              <DatePicker
                value={bidDue}
                onChange={setBidDue}
                className="h-8 px-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-0.5">Win Probability (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={winProb}
                onChange={e => setWinProb(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="0–100"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setEditing(false); setBidDue(p.bid_due_date ?? ''); setWinProb(p.win_probability != null ? String(p.win_probability) : '') }}
              className="h-7 px-3 rounded text-xs border border-input hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleQuickSave}
              disabled={saving}
              className="h-7 px-3 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <ProjectCard
        project={project}
        counts={counts}
        parentName={parentName}
        highlight={highlight}
      />

      {/* Quick-edit button — appears on hover */}
      <button
        title="Quick edit: bid date & win %"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setEditing(true) }}
        className="absolute top-3 right-9 z-10 sm:opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-primary bg-card rounded p-0.5"
      >
        <SlidersHorizontal size={13} />
      </button>

      {/* Trash button — appears on hover */}
      <button
        title="Delete project"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(true) }}
        className="absolute top-3 right-3 z-10 sm:opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive bg-card rounded p-0.5"
      >
        <Trash2 size={13} />
      </button>

      {/*
        The drag handle. A SIBLING of ProjectCard's own anchor, never a
        descendant: a <button> inside an <a> fires BOTH (§12), which is what
        forced /attention's rows from Link to div. Sits below the two action
        buttons so it does not collide with them, and carries no opacity
        transition — it is the only route to a stage change and must be
        reachable without a pointer.
      */}
      {draggable && (
        <DragHandle
          dnd={dnd}
          id={project.id}
          laneId={laneId}
          index={index}
          className="top-auto bottom-1 right-1 md:bottom-1.5 md:right-1.5"
        />
      )}
    </div>
  )
}
