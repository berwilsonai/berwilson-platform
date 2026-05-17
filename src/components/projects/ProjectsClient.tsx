'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Trash2, Layers, FolderOpen } from 'lucide-react'
import ProjectCard, { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import type { Project } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'

interface ProjectsClientProps {
  projects: Project[]
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  on_hold: 'bg-amber-50 text-amber-700 ring-amber-200',
  won: 'bg-blue-50 text-blue-700 ring-blue-200',
  lost: 'bg-red-50 text-red-600 ring-red-200',
  closed: 'bg-slate-100 text-slate-500 ring-slate-200',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}

function formatValue(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

function ProgramBanner({ program, childCount }: { program: Project; childCount: number }) {
  const status = program.status ?? 'active'

  return (
    <Link
      href={`/projects/${program.id}`}
      className="group block rounded-lg border border-violet-200 bg-violet-50/40 hover:bg-violet-50/70 transition-colors shadow-sm"
    >
      <div className="flex items-center gap-4 px-5 py-4">
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
              STATUS_STYLES[status]
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
      </div>
    </Link>
  )
}

export default function ProjectsClient({ projects: initialProjects }: ProjectsClientProps) {
  const [projects, setProjects] = useState(initialProjects)

  function handleDelete(id: string) {
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  // Build hierarchy
  const childrenOf = new Map<string, Project[]>()
  const parentIds = new Set<string>()

  for (const p of projects) {
    if (p.parent_project_id) {
      const siblings = childrenOf.get(p.parent_project_id) ?? []
      siblings.push(p)
      childrenOf.set(p.parent_project_id, siblings)
      parentIds.add(p.parent_project_id)
    }
  }

  const programs: Project[] = []
  const standalone: Project[] = []
  for (const p of projects) {
    if (p.parent_project_id) continue
    if (parentIds.has(p.id)) {
      programs.push(p)
    } else {
      standalone.push(p)
    }
  }

  return (
    <div className="space-y-6">
      {/* Programs with children */}
      {programs.map(parent => {
        const children = childrenOf.get(parent.id) ?? []
        return (
          <div key={parent.id} className="space-y-3">
            <ProgramBanner program={parent} childCount={children.length} />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-5 border-l-2 border-violet-200 ml-4">
              {children.map(child => (
                <DeletableCard
                  key={child.id}
                  project={child}
                  parentName={parent.name}
                  onDeleted={() => handleDelete(child.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Divider between programs and standalone */}
      {programs.length > 0 && standalone.length > 0 && (
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Independent Projects
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      {/* Standalone projects */}
      {standalone.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {standalone.map(project => (
            <DeletableCard
              key={project.id}
              project={project}
              onDeleted={() => handleDelete(project.id)}
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
}: {
  project: Project
  counts?: ProjectCardCounts
  parentName?: string
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted()
      } else {
        setDeleting(false)
        setConfirming(false)
      }
    } catch {
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

      <ProjectCard
        project={project}
        counts={counts}
        parentName={parentName}
      />

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
