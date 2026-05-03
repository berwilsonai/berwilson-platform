import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS } from '@/lib/utils/stages'
import ProjectTabBar from '@/components/projects/ProjectTabBar'
import AgentSidebar from '@/components/agent/AgentSidebar'

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

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function ProjectLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, sector, status, stage, client_entity, location')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const status = project.status ?? 'active'
  const stage = project.stage ?? 'pursuit'

  return (
    <div className="space-y-0">
      {/* Breadcrumb + project header */}
      <div className="pb-5 space-y-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={13} />
          Projects
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight truncate">{project.name}</h1>
            {project.client_entity && (
              <p className="text-sm text-muted-foreground mt-0.5">{project.client_entity}</p>
            )}
          </div>

          {/* Status / sector / stage badges */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                SECTOR_BADGE[project.sector]
              )}
            >
              {SECTOR_LABELS[project.sector]}
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                STATUS_STYLES[status]
              )}
            >
              {STATUS_LABELS[status]}
            </span>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-slate-50 text-slate-600 ring-slate-200">
              {STAGE_LABELS[stage]}
            </span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <ProjectTabBar projectId={id} />

      {/* Tab content */}
      <div className="pt-6">{children}</div>

      {/* Agent chat sidebar */}
      <AgentSidebar projectId={id} />
    </div>
  )
}
