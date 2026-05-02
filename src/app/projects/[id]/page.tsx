import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Pencil, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Entity, EntityProject } from '@/lib/supabase/types'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase.from('projects').select('name').eq('id', id).single()
  return { title: data?.name ? `${data.name} — Ber Wilson Intelligence` : 'Project — Ber Wilson Intelligence' }
}

type EntityProjectWithEntity = EntityProject & { entity: Entity }

const ENTITY_TYPE_LABELS: Record<string, string> = {
  llc: 'LLC', corp: 'Corp', jv: 'JV', subsidiary: 'Subsidiary',
  trust: 'Trust', fund: 'Fund', other: 'Other',
}

const ENTITY_TYPE_STYLES: Record<string, string> = {
  llc: 'bg-blue-50 text-blue-700 ring-blue-200',
  corp: 'bg-violet-50 text-violet-700 ring-violet-200',
  jv: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  subsidiary: 'bg-amber-50 text-amber-700 ring-amber-200',
  trust: 'bg-rose-50 text-rose-700 ring-rose-200',
  fund: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  other: 'bg-slate-50 text-slate-600 ring-slate-200',
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner', jv_partner: 'JV Partner', sub_entity: 'Sub-Entity', guarantor: 'Guarantor',
}

function formatValue(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

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

const ACTIVITY_TABLE_LABELS: Record<string, string> = {
  projects: 'Projects',
  updates: 'Updates',
  documents: 'Documents',
  milestones: 'Milestones',
  dd_items: 'Diligence',
  financing_structures: 'Financing',
  compliance_items: 'Compliance',
  review_queue: 'Review Queue',
  parties: 'Parties',
  project_players: 'Team',
}

const ACTIVITY_ACTION_STYLES: Record<string, string> = {
  INSERT: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 ring-blue-200',
  DELETE: 'bg-red-50 text-red-600 ring-red-200',
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

  const [{ data: project }, { data: activityLogs }, { data: entityLinksRaw }] = await Promise.all([
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
  ])

  if (!project) notFound()

  const entityLinks = (entityLinksRaw ?? []) as EntityProjectWithEntity[]

  // Resolve user actor IDs to emails
  const userActorIds = [
    ...new Set(
      (activityLogs ?? [])
        .filter((l) => l.actor_type === 'user' && l.actor_id)
        .map((l) => l.actor_id!)
    ),
  ]
  const actorEmails: Record<string, string> = {}
  if (userActorIds.length > 0) {
    const { data: usersData } = await supabase.auth.admin.listUsers()
    for (const user of usersData?.users ?? []) {
      if (user.email) actorEmails[user.id] = user.email
    }
  }

  function displayActor(aType: string | null, aId: string | null): string {
    if (!aType || aType === 'system') return 'System'
    if (aType === 'ai') return 'AI'
    if (aType === 'user' && aId) return actorEmails[aId] ?? aId.slice(0, 8) + '…'
    return 'Unknown'
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Edit action */}
      <div className="flex justify-end">
        <Link
          href={`/projects/${id}/edit`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Pencil size={12} />
          Edit
        </Link>
      </div>

      {/* Description */}
      {project.description && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </h2>
          <p className="text-sm text-foreground leading-relaxed">{project.description}</p>
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
                    ENTITY_TYPE_STYLES[ep.entity.entity_type] ?? ENTITY_TYPE_STYLES.other
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
        {activityLogs && activityLogs.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {activityLogs.map((log) => {
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
                        {displayActor(log.actor_type, log.actor_id)}
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
