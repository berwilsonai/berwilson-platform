'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Trash2, Layers, FolderOpen, Search, X, ChevronDown, GitBranch, Kanban, SlidersHorizontal } from 'lucide-react'
import ProjectCard, { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import type { Project, ProjectStage } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { useStoredState } from '@/hooks/use-stored-state'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'
import {
  STATUS_BADGE, STATUS_LABELS, formatValue, weightedValue,
  STAGES, STAGE_LABELS, STAGE_BADGE, STAGE_COLOR,
} from '@/lib/utils/constants'

type ViewMode = 'program' | 'pipeline'

interface ProjectsClientProps {
  projects: Project[]
  /** Active stage filter from the URL. When set, the pipeline board shows only this stage's column. */
  stageFilter?: string
}

function ProgramBanner({
  program,
  childCount,
  isCollapsed,
  onToggle,
}: {
  program: Project
  childCount: number
  isCollapsed: boolean
  onToggle: () => void
}) {
  const status = program.status ?? 'active'

  return (
    <div className="flex items-stretch gap-0 rounded-lg border border-violet-200 bg-violet-50/40 shadow-sm overflow-hidden">
      <Link
        href={`/projects/${program.id}`}
        className="group flex items-center gap-4 px-5 py-4 flex-1 min-w-0 hover:bg-violet-50/70 transition-colors"
      >
        {/* Icon */}
        <div className="flex items-center justify-center w-9 h-9 rounded-md bg-violet-100 text-violet-600 shrink-0">
          <Layers size={18} />
        </div>

        {/* Name + entity */}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-violet-500 mb-0.5">
            Program
          </p>
          <h2 className="text-[15px] font-semibold text-foreground leading-tight group-hover:text-violet-700 transition-colors truncate">
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
          <span className="text-sm font-bold tabular-nums text-foreground">
            {formatValue(program.estimated_value)}
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
        className="flex items-center justify-center w-10 border-l border-violet-200 text-violet-400 hover:text-violet-600 hover:bg-violet-100/60 transition-colors shrink-0"
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
  const [projects, setProjects] = useState(initialProjects)
  // When a stage filter is active in the URL, restrict the pipeline columns to
  // just that stage so the board doesn't keep rendering every (mostly empty)
  // stage. No filter → show the full funnel.
  const stageColumns = (stageFilter && STAGES.includes(stageFilter as ProjectStage)
    ? [stageFilter as ProjectStage]
    : STAGES) as ProjectStage[]
  const [search, setSearch] = useState('')
  const [storedView, setView] = useStoredState<ViewMode>('bw.projects.view', 'pipeline')
  // Normalize any legacy stored values ('stage' / 'board') to the new 'pipeline'.
  const view: ViewMode = storedView === 'program' ? 'program' : 'pipeline'
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

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return projects
    const q = search.toLowerCase()
    return projects.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q) ||
        (p.client_entity ?? '').toLowerCase().includes(q) ||
        (p.solicitation_number ?? '').toLowerCase().includes(q)
    )
  }, [projects, search])

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

  // Stage view: group every matching project (flat) by its stage.
  const byStage = useMemo(() => {
    const groups = new Map<ProjectStage, Project[]>()
    for (const p of filtered) {
      const stage = (p.stage ?? 'pursuit') as ProjectStage
      const arr = groups.get(stage) ?? []
      arr.push(p)
      groups.set(stage, arr)
    }
    return groups
  }, [filtered])

  const viewToggle = (
    <div className="flex items-center gap-2 shrink-0">
      <span className="hidden sm:inline text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        View
      </span>
      <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
        <button
          onClick={() => setView('pipeline')}
          title="See the whole bid funnel, grouped by stage"
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors',
            view === 'pipeline' ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
          )}
        >
          <Kanban size={12} />
          Pipeline
        </button>
        <button
          onClick={() => setView('program')}
          title="Group projects under their parent program"
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-border',
            view === 'program' ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
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
              placeholder="Search projects by name, location, client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-8 pr-8 w-full sm:w-72 rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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

      {filtered.length === 0 && search && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No projects match &ldquo;{search}&rdquo;
        </div>
      )}

      {/* ─── Pipeline (mobile): stage groups stacked top-to-bottom ──────────── */}
      {view === 'pipeline' && filtered.length > 0 && (
        <div className="space-y-6 lg:hidden">
          {stageColumns.filter(s => (byStage.get(s as ProjectStage)?.length ?? 0) > 0).map(s => {
            const stage = s as ProjectStage
            const items = byStage.get(stage) ?? []
            return (
              <div key={stage} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={cn('inline-block w-2 h-2 rounded-full', STAGE_COLOR[stage])} />
                  <h2 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h2>
                  <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_BADGE[stage])}>
                    {items.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {items.map(project => (
                    <DeletableCard
                      key={project.id}
                      project={project}
                      parentName={project.parent_project_id ? nameById.get(project.parent_project_id) : undefined}
                      onDeleted={() => handleDelete(project.id)}
                      onUpdated={(patch) => handleUpdate(project.id, patch)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Pipeline (desktop): horizontal Kanban board by stage ───────────── */}
      {view === 'pipeline' && filtered.length > 0 && (
        <div className="hidden lg:flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
          {stageColumns.map((s) => {
            const stage = s as ProjectStage
            const items = byStage.get(stage) ?? []
            const colValue = items.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0)
            const colWeighted = items.reduce(
              (sum, p) => sum + weightedValue(p.estimated_value, (p as { win_probability?: number | null }).win_probability ?? null),
              0
            )
            return (
              <div key={stage} className="flex flex-col w-[300px] shrink-0">
                {/* Column header */}
                <div className="sticky top-0 z-10 rounded-t-lg border border-b-0 border-border bg-muted/40 backdrop-blur px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', STAGE_COLOR[stage])} />
                    <h2 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h2>
                    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_BADGE[stage])}>
                      {items.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs">
                    <span className="font-semibold tabular-nums text-foreground">{formatValue(colValue)}</span>
                    {colWeighted > 0 && (
                      <span className="tabular-nums text-emerald-600">{formatValue(colWeighted)} wtd</span>
                    )}
                  </div>
                </div>
                {/* Column body */}
                <div className="flex-1 space-y-3 rounded-b-lg border border-t-0 border-border bg-muted/10 p-2 min-h-[120px]">
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 text-center py-6">No projects</p>
                  ) : (
                    items.map((project) => (
                      <DeletableCard
                        key={project.id}
                        project={project}
                        parentName={project.parent_project_id ? nameById.get(project.parent_project_id) : undefined}
                        onDeleted={() => handleDelete(project.id)}
                        onUpdated={(patch) => handleUpdate(project.id, patch)}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
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
              childCount={children.length}
              isCollapsed={isCollapsed}
              onToggle={() => toggleProgram(parent.id)}
            />
            {!isCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-5 border-l-2 border-violet-200 ml-4">
                {children.map(child => (
                  <DeletableCard
                    key={child.id}
                    project={child}
                    parentName={parent.name}
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
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
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
  onDeleted,
  onUpdated,
}: {
  project: Project
  counts?: ProjectCardCounts
  parentName?: string
  onDeleted: () => void
  onUpdated?: (patch: Partial<Project>) => void
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

  return (
    <div className="relative group/card">
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
              <input
                type="date"
                value={bidDue}
                onChange={e => setBidDue(e.target.value)}
                onClick={e => e.stopPropagation()}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
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
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
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
      />

      {/* Quick-edit button — appears on hover */}
      <button
        title="Quick edit: bid date & win %"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setEditing(true) }}
        className="absolute top-3 right-9 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground hover:text-primary bg-card rounded p-0.5"
      >
        <SlidersHorizontal size={13} />
      </button>

      {/* Trash button — appears on hover */}
      <button
        title="Delete project"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(true) }}
        className="absolute top-3 right-3 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity text-muted-foreground hover:text-destructive bg-card rounded p-0.5"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}
