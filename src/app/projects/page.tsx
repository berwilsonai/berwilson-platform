import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, FolderKanban, GanttChart } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProjectSector, ProjectStatus, ProjectStage } from '@/lib/supabase/types'
import { SECTORS, STATUSES, STAGES } from '@/lib/utils/constants'
import { getViewer, accessibleProjectIds } from '@/lib/auth/viewer'

export const metadata = { title: 'Projects — Ber Wilson Intelligence' }
import EmptyState from '@/components/shared/EmptyState'
import ProjectFilters from '@/components/projects/ProjectFilters'
import ProjectsClient from '@/components/projects/ProjectsClient'
import ProtectedProjectList from '@/components/security/ProtectedProjectList'
import { dropHidden } from '@/lib/security/confidential'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import { PageHeader, HeaderMetrics } from '@/components/ui/page-header'
import { coverageNote, portfolioTotal } from '@/lib/records/pipeline-value'
import { formatValue } from '@/lib/utils/constants'

interface PageProps {
  searchParams: Promise<{ sector?: string; status?: string; stage?: string }>
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const sector = SECTORS.includes(params.sector as ProjectSector)
    ? (params.sector as ProjectSector)
    : ''
  const status = STATUSES.includes(params.status as ProjectStatus)
    ? (params.status as ProjectStatus)
    : ''
  const stage = STAGES.includes(params.stage as ProjectStage)
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

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`)
  }

  // Non-admins only see granted projects (parent grants cover children).
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? true
  let projects = data ?? []
  if (!isAdmin && viewer) {
    const allowed = await accessibleProjectIds(viewer)
    if (allowed) projects = projects.filter((p) => allowed.has(p.id))
  }

  // Protected projects come out of the portfolio and go into their own block —
  // by NAME only, so an admin can still find and unlock one. For anyone who
  // could never hold a step-up, viewerHiddenProjectIds() returns every
  // confidential project and they simply are not here.
  const hidden = await viewerHiddenProjectIds()
  const protectedProjects = isAdmin
    ? projects.filter((p) => hidden.has(p.id)).map((p) => ({ id: p.id, name: p.name }))
    : []
  projects = dropHidden(projects, (p) => p.id, hidden)

  const count = projects?.length ?? 0
  const hasFilters = sector || status || stage

  /*
    The masthead's own figures.

    ⚠ `portfolioTotal`, NEVER `pipelineTotal` — this set is read straight from
    `projects`, so it holds programs AND their sub-projects at once and a bare
    sum would count the same money twice. That is the module's own documented
    rule, and the metric strip is a new reader of it.
  */
  const total = portfolioTotal(projects)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description={hasFilters ? 'Filtered view — clear the filters to see the whole portfolio.' : undefined}
        actions={
          isAdmin ? (
            <>
              <Link
                href="/timeline"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border bg-card text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <GanttChart size={14} />
                Timeline
              </Link>
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Project
              </Link>
            </>
          ) : undefined
        }
        metrics={
          count > 0 ? (
            <HeaderMetrics
              items={[
                { label: hasFilters ? 'matching' : 'projects', value: count },
                ...(total.amount > 0
                  ? [
                      {
                        label: coverageNote(total) ?? 'pipeline',
                        value: formatValue(total.amount),
                      },
                    ]
                  : []),
              ]}
            />
          ) : undefined
        }
      >
        <Suspense>
          <ProjectFilters sector={sector} status={status} stage={stage} />
        </Suspense>
      </PageHeader>

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
            !hasFilters && isAdmin ? (
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Project
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ProjectsClient projects={projects} stageFilter={stage} />
      )}

      <ProtectedProjectList projects={protectedProjects} />
    </div>
  )
}
