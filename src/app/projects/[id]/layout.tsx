import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Map as MapIcon } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGE_BADGE } from '@/lib/utils/stages'
import { STATUS_BADGE, STATUS_LABELS } from '@/lib/utils/constants'
import ProjectTabBar from '@/components/projects/ProjectTabBar'
import { getViewer, canAccessProject } from '@/lib/auth/viewer'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function ProjectLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, sector, status, stage, client_entity, location, latitude, longitude, map_geometry')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Grant check — non-admins only reach projects they've been granted
  // (directly or via a parent project). 404 rather than 403: don't confirm
  // the project exists.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !(await canAccessProject(viewer, id))) notFound()

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
            <h1 className="text-xl font-semibold leading-tight truncate">{project.name}</h1>
            {project.client_entity && (
              <p className="text-sm text-muted-foreground mt-0.5">{project.client_entity}</p>
            )}
          </div>

          {/* Stage / sector / status badges */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                STAGE_BADGE[stage]
              )}
            >
              {STAGE_LABELS[stage]}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                SECTOR_BADGE[project.sector]
              )}
            >
              {SECTOR_LABELS[project.sector]}
            </span>
            {status !== 'active' && (
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                  STATUS_BADGE[status]
                )}
              >
                {STATUS_LABELS[status]}
              </span>
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
      </div>

      {/* Tab bar */}
      <ProjectTabBar projectId={id} />

      {/* Tab content */}
      <div className="pt-6">{children}</div>
    </div>
  )
}
