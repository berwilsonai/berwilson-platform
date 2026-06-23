'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, FolderOpen, LayoutGrid, GitBranch } from 'lucide-react'
import ProjectCard, { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import type { Project, ProjectStage } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { useStoredState } from '@/hooks/use-stored-state'
import { STAGES, STAGE_LABELS, STAGE_BADGE, STAGE_COLOR } from '@/lib/utils/constants'

type ViewMode = 'program' | 'stage'
type Preset = 'all' | 'sales' | 'ops'

// Role-oriented focus presets. Sales lives in the pursuit→bid stages;
// Operations lives in award→closeout. "All" shows everything.
const PRESET_STAGES: Record<Preset, ProjectStage[] | null> = {
  all: null,
  sales: ['pursuit', 'capture', 'bid'],
  ops: ['award', 'mobilization', 'execution', 'closeout'],
}

const PRESET_LABELS: Record<Preset, string> = {
  all: 'All Projects',
  sales: 'Sales Focus',
  ops: 'Operations Focus',
}

interface DashboardProjectsProps {
  projects: Project[]
  counts: Record<string, ProjectCardCounts>
}

export default function DashboardProjects({ projects, counts }: DashboardProjectsProps) {
  const [view, setView] = useStoredState<ViewMode>('bw.dashboard.view', 'program')
  const [preset, setPreset] = useStoredState<Preset>('bw.dashboard.preset', 'all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Apply the role-focus preset (a stage filter)
  const allowed = PRESET_STAGES[preset]
  const filtered = useMemo(() => {
    if (!allowed) return projects
    const set = new Set(allowed)
    return projects.filter(p => set.has((p.stage ?? 'pursuit') as ProjectStage))
  }, [projects, allowed])

  // Hierarchy (only nest a child when its parent is present in the filtered set)
  const presentIds = new Set(filtered.map(p => p.id))
  const nameById = new Map(projects.map(p => [p.id, p.name]))
  const childrenOf = new Map<string, Project[]>()
  const parentIds = new Set<string>()
  for (const p of filtered) {
    if (p.parent_project_id && presentIds.has(p.parent_project_id)) {
      const arr = childrenOf.get(p.parent_project_id) ?? []
      arr.push(p)
      childrenOf.set(p.parent_project_id, arr)
      parentIds.add(p.parent_project_id)
    }
  }
  const topLevel: Project[] = []
  for (const p of filtered) {
    if (p.parent_project_id && presentIds.has(p.parent_project_id)) continue
    topLevel.push(p)
  }

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

  return (
    <div className="space-y-4">
      {/* Controls: role preset + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
          {(['all', 'sales', 'ops'] as Preset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={cn(
                'px-2.5 py-1.5 transition-colors border-r border-border last:border-r-0',
                preset === p ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
          <button
            onClick={() => setView('program')}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 transition-colors',
              view === 'program' ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <GitBranch size={12} />
            Program
          </button>
          <button
            onClick={() => setView('stage')}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 transition-colors border-l border-border',
              view === 'stage' ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            <LayoutGrid size={12} />
            Stage
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No active projects in this focus.
        </div>
      )}

      {/* Stage view */}
      {view === 'stage' && filtered.length > 0 && (
        <div className="space-y-5">
          {STAGES.filter(s => (byStage.get(s as ProjectStage)?.length ?? 0) > 0).map(s => {
            const stage = s as ProjectStage
            const items = byStage.get(stage) ?? []
            return (
              <div key={stage} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={cn('inline-block w-2 h-2 rounded-full', STAGE_COLOR[stage])} />
                  <h3 className="text-sm font-semibold text-foreground">{STAGE_LABELS[stage]}</h3>
                  <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', STAGE_BADGE[stage])}>
                    {items.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger-children">
                  {items.map(p => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      counts={counts[p.id]}
                      parentName={p.parent_project_id ? nameById.get(p.parent_project_id) : undefined}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Program view — sub-projects rolled up under their program */}
      {view === 'program' && filtered.length > 0 && (
        <div className="space-y-3">
          {topLevel.map(p => {
            const kids = childrenOf.get(p.id) ?? []
            const isProgram = kids.length > 0
            const isCollapsed = collapsed.has(p.id)
            return (
              <div key={p.id} className="space-y-2">
                <div className="relative">
                  <ProjectCard project={p} counts={counts[p.id]} isProgram={isProgram} />
                  {isProgram && (
                    <button
                      onClick={() => toggle(p.id)}
                      className="absolute top-3 right-3 inline-flex items-center gap-1 rounded border border-border bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      title={isCollapsed ? 'Show sub-projects' : 'Hide sub-projects'}
                    >
                      <FolderOpen size={11} />
                      {kids.length}
                      <ChevronDown size={12} className={cn('transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')} />
                    </button>
                  )}
                </div>
                {isProgram && !isCollapsed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-4 border-l-2 border-violet-200 dark:border-violet-800/60 ml-2">
                    {kids.map(c => (
                      <ProjectCard key={c.id} project={c} counts={counts[c.id]} parentName={p.name} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
