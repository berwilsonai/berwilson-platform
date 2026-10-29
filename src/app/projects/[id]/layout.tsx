import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Map as MapIcon, Pencil } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Chip } from '@/components/ui/chip'
import { SECTOR_BADGE, SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGE_BADGE } from '@/lib/utils/stages'
import { STATUS_BADGE, STATUS_LABELS } from '@/lib/utils/constants'
import RecordTabBar from '@/components/records/RecordTabBar'
import RecordLogMenu from '@/components/records/RecordLogMenu'
import GenerateBriefButton from '@/components/projects/GenerateBriefButton'
import ProjectProtection from '@/components/security/ProjectProtection'
import TrackVisit from '@/components/shared/TrackVisit'
import RecordPager from '@/components/records/RecordPager'
import { PROJECT_TABS } from '@/components/records/tabs'
import { getViewer, canAccessProject } from '@/lib/auth/viewer'
import { parcelDb } from '@/lib/parcels/queries'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function ProjectLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, sector, status, stage, client_entity, location, latitude, longitude, map_geometry, confidential, data_room_template')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Grant check — non-admins only reach projects they've been granted
  // (directly or via a parent project). 404 rather than 403: don't confirm
  // the project exists.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !(await canAccessProject(viewer, id))) notFound()

  // Which tabs actually hold anything — a tab with no rows waits under More
  // unless `tabs.ts` marks it `always`. Read the reasoning there; the short
  // version is that gating is right for READING and wrong for the first WRITE,
  // which is why the five tabs a human types into no longer depend on a count.
  //
  // Head counts with a filter on an indexed column, run in parallel: the rows
  // are never fetched, only counted, so this is one cheap round trip.
  const count = async (
    table: 'project_players' | 'updates' | 'meetings' | 'tasks' | 'documents' | 'milestones' | 'financing_structures' | 'dd_items' | 'entity_projects'
  ) => {
    /*
      ⚠ `documents` MUST EXCLUDE THE GRAVEYARD (§12: read it with
      `superseded_at is null` or the graveyard reads as a gap). Steelton's tab
      badge said 191 while the tab's own heading said 191 and its filter chip
      said "All 188" — three numbers for one quantity, two of them counting
      rows the list below cannot show. Superseded documents are reachable from
      the document they replaced; they are not part of the count.
    */
    const q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('project_id', id)
    const { count: n } = await (table === 'documents' ? q.is('superseded_at', null) : q)
    return n ?? 0
  }
  // project_parcels counts through its own untyped client rather than the
  // helper above, because the embed-heavy read the helper does cannot infer it.
  const countParcels = async () => {
    const { count: n } = await parcelDb()
      .from('project_parcels')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', id)
    return n ?? 0
  }

  const [players, updates, meetings, tasks, documents, milestones, financing, diligence, entities, parcels] =
    await Promise.all([
      count('project_players'), count('updates'), count('meetings'), count('tasks'),
      count('documents'), count('milestones'), count('financing_structures'),
      count('dd_items'), count('entity_projects'), countParcels(),
    ])
  const tabCounts = {
    players, updates, meetings, tasks, documents, milestones, financing, diligence, entities, parcels,
    // ⚠ NOT A ROW COUNT. The Data room tab shows when this record is on the
    // data-room template, and the bar's existing show-if-non-zero rule is how
    // that is expressed — a second mechanism for hiding a tab is a second
    // thing to keep in step with `tabs.ts`.
    dataRoom: project.data_room_template === 'data_center' ? 1 : 0,
  }

  const status = project.status ?? 'active'
  const stage = project.stage ?? 'pursuit'

  return (
    <div className="space-y-0">
      {/* Breadcrumb + project header */}
      <div className="pb-5 space-y-3">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            href="/projects"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Projects
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground font-medium truncate max-w-[300px]">{project.name}</span>
        </nav>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold leading-tight truncate">{project.name}</h1>
              <div className="shrink-0">
                <RecordPager kind="project" currentId={id} />
              </div>
            </div>
            {project.client_entity && (
              <p className="text-sm text-muted-foreground mt-0.5">{project.client_entity}</p>
            )}
          </div>

          {/*
            Identity on the left, ACTIONS on the right — the same shape the
            opportunity header already had. They used to sit mid-page on the
            Overview tab, below the photo gallery, which meant Edit and Brief
            were unreachable from any other tab and "log something by hand"
            had no home at all. `RecordLogMenu` leads, because creating is the
            act you arrive wanting to do.
          */}
          <div className="flex items-center gap-2 shrink-0">
            <RecordLogMenu
              basePath={`/projects/${id}`}
              kind="project"
              canLogMeeting={viewer?.isAdmin ?? false}
            />
            <GenerateBriefButton recordId={id} recordName={project.name} />
            <Link
              href={`/projects/${id}/edit`}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
            >
              <Pencil size={13} />
              Edit
            </Link>
            {viewer?.isAdmin && (
              <ProjectProtection projectId={id} confidential={project.confidential === true} />
            )}
          </div>
        </div>

        {/* Stage / sector / status — what the record IS, under its name. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Chip tone={STAGE_BADGE[stage]}>{STAGE_LABELS[stage]}</Chip>
          <Chip tone={SECTOR_BADGE[project.sector]}>{SECTOR_LABELS[project.sector]}</Chip>
          {status !== 'active' && (
            <Chip tone={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Chip>
          )}
          {/* /map is admin-only, so only admins get the link */}
          {viewer?.isAdmin && (project.latitude != null || project.map_geometry != null) && (
            <Link
              href={`/map?project=${project.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <MapIcon size={12} />
              View on map
            </Link>
          )}
        </div>
      </div>

      {/* Remembered as "recently opened" for ⌘K. Here rather than in the
          shell because this is the component that knows the deal's NAME. */}
      <TrackVisit kind="project" label={project.name} href={`/projects/${id}`} />

      {/* Tab bar */}
      <RecordTabBar basePath={`/projects/${id}`} tabs={PROJECT_TABS} counts={tabCounts} />

      {/* Tab content */}
      <div className="pt-6">{children}</div>
    </div>
  )
}
