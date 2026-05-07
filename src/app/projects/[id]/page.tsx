import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Pencil, ExternalLink, Layers, ChevronRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createAdminClient } from '@/lib/supabase/admin'
import GenerateBriefButton from '@/components/projects/GenerateBriefButton'
import ProjectNarrativeBrief from '@/components/projects/ProjectNarrativeBrief'
import MediaGallery from '@/components/shared/MediaGallery'
import type { Entity, EntityProject, Project } from '@/lib/supabase/types'
import type { Metadata } from 'next'
import {
  SECTOR_BADGE, SECTOR_SHORT, STAGE_LABELS,
  ENTITY_TYPE_LABELS, ENTITY_TYPE_BADGE, RELATIONSHIP_LABELS,
  ACTIVITY_TABLE_LABELS, ACTIVITY_ACTION_STYLES,
  formatValue, formatDate,
} from '@/lib/utils/constants'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase.from('projects').select('name').eq('id', id).single()
  return { title: data?.name ? `${data.name} — Ber Wilson Intelligence` : 'Project — Ber Wilson Intelligence' }
}

type EntityProjectWithEntity = EntityProject & { entity: Entity }

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value || '—'}</dd>
    </div>
  )
}

function activityRecordLink(tableName: string, recordId: string | null, projectId: string): string | null {
  switch (tableName) {
    case 'projects': return `/projects/${projectId}`
    case 'updates': return `/projects/${projectId}/updates`
    case 'documents': return `/projects/${projectId}/documents`
    case 'milestones': return `/projects/${projectId}/milestones`
    case 'dd_items': return `/projects/${projectId}/diligence`
    case 'financing_structures': return `/projects/${projectId}/financing`
    case 'compliance_items': return `/projects/${projectId}/milestones`
    case 'review_queue': return '/review'
    default: return null
  }
}

function formatActivityTs(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectOverviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: project }, { data: activityLogs }, { data: entityLinksRaw }, { data: childProjects }, { data: projectPhotos }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase
      .from('activity_log')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('entity_projects')
      .select('*, entity:entities(id, name, entity_type, jurisdiction, ownership_pct)')
      .eq('project_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('projects')
      .select('id, name, sector, status, stage, estimated_value, location')
      .eq('parent_project_id', id)
      .order('name'),
    supabase
      .from('media')
      .select('*')
      .eq('project_id', id)
      .order('is_primary', { ascending: false })
      .order('sort_order')
      .order('created_at'),
  ])

  if (!project) notFound()

  // Fetch parent project name if this is a child
  let parentProject: Pick<Project, 'id' | 'name'> | null = null
  if (project.parent_project_id) {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', project.parent_project_id)
      .single()
    parentProject = data
  }

  const isProgram = (childProjects ?? []).length > 0

  const entityLinks = (entityLinksRaw ?? []) as EntityProjectWithEntity[]

  // Cast activity logs to include new columns (may not be in generated types until gen-types runs)
  type ActivityLogWithExtras = typeof activityLogs extends (infer T)[] | null ? T & { actor_email?: string | null; field_changes?: Record<string, { old: unknown; new: unknown }> | null } : never
  const typedLogs = (activityLogs ?? []) as ActivityLogWithExtras[]

  function displayActor(log: { actor_type: string | null; actor_id: string | null; actor_email?: string | null }): string {
    if (!log.actor_type || log.actor_type === 'system') return 'System'
    if (log.actor_type === 'ai') return 'AI'
    if (log.actor_type === 'user') return log.actor_email ?? (log.actor_id ? log.actor_id.slice(0, 8) + '…' : 'User')
    return 'Unknown'
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Parent breadcrumb for child projects */}
      {parentProject && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers size={12} className="text-violet-500" />
          <span>Part of</span>
          <Link
            href={`/projects/${parentProject.id}`}
            className="font-medium text-violet-600 hover:text-violet-800 transition-colors"
          >
            {parentProject.name}
          </Link>
        </div>
      )}

      {/* Photo gallery */}
      <MediaGallery
        initialPhotos={projectPhotos ?? []}
        scope={{ projectId: id }}
      />

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <GenerateBriefButton projectId={id} projectName={project.name} />
        <Link
          href={`/projects/${id}/edit`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Pencil size={12} />
          Edit
        </Link>
      </div>

      {/* Narrative brief — AI-generated executive summary */}
      <ProjectNarrativeBrief projectId={id} projectName={project.name} />

      {/* Description */}
      {project.description && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </h2>
          <p className="text-sm text-foreground leading-relaxed">{project.description}</p>
        </section>
      )}

      {/* Sub-Projects (for programs) */}
      {isProgram && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Layers size={12} className="text-violet-500" />
                Sub-Projects ({(childProjects ?? []).length})
              </span>
            </h2>
            <Link
              href={`/projects/new?parent=${id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={12} />
              Add Sub-Project
            </Link>
          </div>
          <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
            {(childProjects ?? []).map((child) => (
              <Link
                key={child.id}
                href={`/projects/${child.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
              >
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                    SECTOR_BADGE[child.sector]
                  )}
                >
                  {SECTOR_SHORT[child.sector]}
                </span>
                <span className="text-sm font-medium text-foreground flex-1 truncate group-hover:text-blue-600 transition-colors">
                  {child.name}
                </span>
                {child.stage && (
                  <span className="text-xs text-muted-foreground hidden sm:block shrink-0">
                    {STAGE_LABELS[child.stage]}
                  </span>
                )}
                <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                  {formatValue(child.estimated_value)}
                </span>
                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            Aggregated value: <span className="font-semibold text-foreground">
              {formatValue(
                (project.estimated_value ?? 0) +
                (childProjects ?? []).reduce((sum, c) => sum + (c.estimated_value ?? 0), 0)
              )}
            </span>
          </div>
        </section>
      )}

      {/* Contract & value */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contract
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <Field label="Estimated Value" value={formatValue(project.estimated_value)} />
          <Field label="Contract Type" value={project.contract_type} />
          <Field label="Delivery Method" value={project.delivery_method} />
          <Field label="Client Entity" value={project.client_entity} />
          <Field label="Location" value={project.location} />
          {project.solicitation_number && (
            <Field label="Solicitation No." value={project.solicitation_number} />
          )}
        </dl>
      </section>

      {/* Key dates */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Key Dates
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          <Field label="Award Date" value={formatDate(project.award_date)} />
          <Field label="NTP Date" value={formatDate(project.ntp_date)} />
          <Field
            label="Substantial Completion"
            value={formatDate(project.substantial_completion_date)}
          />
        </dl>
      </section>

      {/* Corporate entities */}
      {entityLinks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Corporate Entities
            </h2>
            <Link
              href={`/projects/${id}/entities`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Manage →
            </Link>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            {entityLinks.map((ep) => (
              <div
                key={ep.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 border-border"
              >
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                    ENTITY_TYPE_BADGE[ep.entity.entity_type] ?? ENTITY_TYPE_BADGE.other
                  )}
                >
                  {ENTITY_TYPE_LABELS[ep.entity.entity_type] ?? ep.entity.entity_type}
                </span>
                <span className="text-sm font-medium text-foreground flex-1 truncate">
                  {ep.entity.name}
                </span>
                {ep.entity.jurisdiction && (
                  <span className="text-xs text-muted-foreground hidden sm:block shrink-0">
                    {ep.entity.jurisdiction}
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
                  {RELATIONSHIP_LABELS[ep.relationship] ?? ep.relationship}
                </span>
                {ep.equity_pct != null && (
                  <span className="text-xs font-medium text-foreground shrink-0 tabular-nums">
                    {ep.equity_pct}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Activity feed */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent Activity
          </h2>
          <Link
            href={`/activity?project=${id}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </Link>
        </div>
        {typedLogs.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {typedLogs.map((log) => {
                  const link = activityRecordLink(log.table_name, log.record_id, id)
                  const actionStyle = ACTIVITY_ACTION_STYLES[log.action] ?? 'bg-slate-50 text-slate-600 ring-slate-200'
                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap w-36">
                        {formatActivityTs(log.created_at)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap w-20">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${actionStyle}`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-foreground whitespace-nowrap">
                        {ACTIVITY_TABLE_LABELS[log.table_name] ?? log.table_name}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {displayActor(log)}
                        {log.field_changes && typeof log.field_changes === 'object' && (
                          <div className="mt-0.5">
                            {Object.entries(log.field_changes as Record<string, { old: unknown; new: unknown }>).map(([field, change]) => (
                              <span key={field} className="text-[10px] text-foreground/70">
                                {field}: <span className="line-through text-red-500/70">{String(change.old ?? '—')}</span> → <span className="text-emerald-600">{String(change.new ?? '—')}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 w-8">
                        {link && (
                          <Link
                            href={link}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="View record"
                          >
                            <ExternalLink size={12} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
        )}
      </section>
    </div>
  )
}
