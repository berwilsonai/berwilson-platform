import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, FolderKanban } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProjectSector, ProjectStatus, ProjectStage } from '@/lib/supabase/types'

export const metadata = { title: 'Projects — Ber Wilson Intelligence' }
import EmptyState from '@/components/shared/EmptyState'
import ProjectFilters from '@/components/projects/ProjectFilters'
import ProjectsClient from '@/components/projects/ProjectsClient'

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
        <ProjectsClient projects={projects} />
      )}
    </div>
  )
}
