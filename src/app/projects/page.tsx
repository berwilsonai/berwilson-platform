import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, FolderKanban, GanttChart } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProjectSector, ProjectStatus, DealStage } from '@/lib/supabase/types'
import { SECTORS, STATUSES, STAGES } from '@/lib/utils/constants'
import { getViewer, accessibleProjectIds } from '@/lib/auth/viewer'

export const metadata = { title: 'Projects — Ber Wilson Intelligence' }
import EmptyState from '@/components/shared/EmptyState'
import ProjectFilters from '@/components/projects/ProjectFilters'
import SavedViews from '@/components/ui/saved-views'
import { listSavedViews } from '@/lib/views/saved'
import ProjectsClient from '@/components/projects/ProjectsClient'
import ProtectedProjectList from '@/components/security/ProtectedProjectList'
import { dropHidden } from '@/lib/security/confidential'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import { PageHeader, HeaderMetrics } from '@/components/ui/page-header'
import { coverageNote, portfolioTotal } from '@/lib/records/pipeline-value'
import { formatMegawatts, phaseLookup, portfolioPower, powerCoverageNote } from '@/lib/records/power'
import { readPhaseRows } from '@/lib/records/power-read'
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
  const stage = STAGES.includes(params.stage as DealStage)
    ? (params.stage as DealStage)
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

  /*
    The ramp-up schedules for everything on screen.

    ⚠ READ AFTER `dropHidden`, AND THE IDS COME FROM THE FILTERED SET. A
    confidential project is out of every aggregate by §8, and a lookup built
    over the unfiltered list would put its megawatts into the masthead total —
    the same shape as the `head: true` count that reached the sidebar badge
    (§12). The filtered ids are the only ones asked for, so there is nothing to
    withhold afterwards.
  */
  const phaseRows = await readPhaseRows(projects.map((p) => p.id))
  const phasesOf = phaseLookup(phaseRows)

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
  // ⚠ `portfolioPower`, NEVER a flat sum — this set holds programs AND their
  // sub-projects at once, and a bare sum counts the same megawatts twice.
  const power = portfolioPower(projects, phasesOf)

  // Named filter sets for this page. A read failure here is a missing
  // convenience, never a broken list — `listSavedViews` returns [] and says so
  // in the log, because the filters themselves live in the URL and do not
  // depend on this at all.
  const savedViews = await listSavedViews('/projects')

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
                /*
                  ⚠ CAPACITY BEFORE VALUE. Richard, 10-30: the megawatt total
                  *"is the key metric"*, and one project in thirty carries an
                  `estimated_value` at all (§13) — so the money figure is the
                  one that is usually absent, not this.
                  ⚠ AND IT CARRIES ITS COVERAGE. A portfolio total over 16 of
                  30 scheduled deals is the figure most likely to be misread,
                  which is the whole reason `powerCoverageNote` exists.
                */
                ...(power.megawatts > 0
                  ? [
                      {
                        label: powerCoverageNote(power) ?? 'capacity',
                        value: formatMegawatts(power.megawatts),
                      },
                    ]
                  : []),
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
        {/*
          Named filter sets. Shared rows, and choosing one navigates to a URL
          carrying the whole query — so the address bar still describes what is
          on screen and a pasted link means one thing to everybody. The
          `localStorage` replay this page used to have is still forbidden; see
          `url-facets.tsx`.
        */}
        <Suspense>
          <SavedViews views={savedViews} className="mt-2" />
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
        <ProjectsClient projects={projects} stageFilter={stage} phases={phaseRows} />
      )}

      <ProtectedProjectList projects={protectedProjects} />
    </div>
  )
}
