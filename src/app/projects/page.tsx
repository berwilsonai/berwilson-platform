import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, FolderKanban } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Project, ProjectSector, ProjectStatus, ProjectStage } from '@/lib/supabase/types'

export const metadata = { title: 'Projects — Ber Wilson Intelligence' }
import ProjectCard from '@/components/dashboard/ProjectCard'
import EmptyState from '@/components/shared/EmptyState'
import ProjectFilters from '@/components/projects/ProjectFilters'

function ProjectHierarchyGrid({ projects }: { projects: Project[] }) {
  // Build lookup maps
  const byId = new Map(projects.map((p) => [p.id, p]))
  const childrenOf = new Map<string, Project[]>()
  const standalone: Project[] = []
  const parentIds = new Set<string>()

  // Identify which projects are parents (have children in this list)
  for (const p of projects) {
    if (p.parent_project_id) {
      const siblings = childrenOf.get(p.parent_project_id) ?? []
      siblings.push(p)
      childrenOf.set(p.parent_project_id, siblings)
      parentIds.add(p.parent_project_id)
    }
  }

  // Group: programs first, then standalone, skip children (rendered under parents)
  const programs: Project[] = []
  for (const p of projects) {
    if (p.parent_project_id) continue // rendered as child
    if (parentIds.has(p.id)) {
      programs.push(p)
    } else {
      standalone.push(p)
    }
  }

  return (
    <div className="space-y-6">
      {/* Programs with children */}
      {programs.map((parent) => (
        <div key={parent.id} className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <ProjectCard project={parent} isProgram />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-6 border-l-2 border-violet-200 ml-3">
            {(childrenOf.get(parent.id) ?? []).map((child) => (
              <ProjectCard key={child.id} project={child} parentName={parent.name} />
            ))}
          </div>
        </div>
      ))}

      {/* Standalone projects */}
      {standalone.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {standalone.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}

interface PageProps {
  searchParams: Promise<{ sector?: string; status?: string; stage?: string }>
}

const VALID_SECTORS: ProjectSector[] = [
  'government', 'infrastructure', 'real_estate', 'prefab', 'institutional',
]
const VALID_STATUSES: ProjectStatus[] = ['active', 'on_hold', 'won', 'lost', 'closed']
const VALID_STAGES: ProjectStage[] = [
  'pursuit', 'capture', 'bid', 'award', 'mobilization', 'execution', 'closeout',
]

export default async function ProjectsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const sector = VALID_SECTORS.includes(params.sector as ProjectSector)
    ? (params.sector as ProjectSector)
    : ''
  const status = VALID_STATUSES.includes(params.status as ProjectStatus)
    ? (params.status as ProjectStatus)
    : ''
  const stage = VALID_STAGES.includes(params.stage as ProjectStage)
    ? (params.stage as ProjectStage)
    : ''

  const supabase = createAdminClient()

  let query = supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })

  if (sector) query = query.eq('sector', sector)
  if (status) query = query.eq('status', status)
  if (stage) query = query.eq('stage', stage)

  const { data: projects, error } = await query

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`)
  }

  const count = projects?.length ?? 0
  const hasFilters = sector || status || stage

  return (
    <div className="space-y-5">
      {/* Page toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Suspense>
            <ProjectFilters sector={sector} status={status} stage={stage} />
          </Suspense>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} project{count !== 1 ? 's' : ''}
              {hasFilters ? ' matching' : ''}
            </span>
          )}
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          New Project
        </Link>
      </div>

      {/* Cards grid or empty state */}
      {count === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={hasFilters ? 'No projects match these filters' : 'No projects yet'}
          description={
            hasFilters
              ? 'Try adjusting the filters above.'
              : 'Add your first project to start tracking your pipeline.'
          }
          action={
            !hasFilters ? (
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Project
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ProjectHierarchyGrid projects={projects} />
      )}
    </div>
  )
}
