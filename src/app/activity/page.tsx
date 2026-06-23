import { Suspense } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import ActivityFilters from '@/components/activity/ActivityFilters'

export const metadata = { title: 'Activity — Ber Wilson Intelligence' }

const PAGE_SIZE = 50

const TABLE_LABELS: Record<string, string> = {
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

const ACTION_STYLES: Record<string, string> = {
  INSERT: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800/60',
  UPDATE: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60',
  DELETE: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 ring-red-200 dark:ring-red-800/60',
}

function recordLink(tableName: string, recordId: string | null, projectId: string | null): string | null {
  switch (tableName) {
    case 'projects':
      return recordId ? `/projects/${recordId}` : null
    case 'updates':
      return projectId ? `/projects/${projectId}/updates` : null
    case 'documents':
      return projectId ? `/projects/${projectId}/documents` : null
    case 'milestones':
      return projectId ? `/projects/${projectId}/milestones` : null
    case 'dd_items':
      return projectId ? `/projects/${projectId}/diligence` : null
    case 'financing_structures':
      return projectId ? `/projects/${projectId}/financing` : null
    case 'compliance_items':
      return projectId ? `/projects/${projectId}/milestones` : null
    case 'review_queue':
      return '/review'
    default:
      return null
  }
}

function formatTs(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface PageProps {
  searchParams: Promise<{
    project?: string
    table?: string
    actor_type?: string
    from?: string
    to?: string
    page?: string
  }>
}

export default async function ActivityPage({ searchParams }: PageProps) {
  const params = await searchParams
  const project = params.project ?? ''
  const table = params.table ?? ''
  const actorType = params.actor_type ?? ''
  const from = params.from ?? ''
  const to = params.to ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const supabase = createAdminClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .order('name')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('activity_log')
    .select('*, projects(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (project) query = query.eq('project_id', project)
  if (table) query = query.eq('table_name', table)
  if (actorType) query = query.eq('actor_type', actorType)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to + 'T23:59:59')

  const { data: logs, count } = await query

  // Resolve user actor IDs to emails
  const userActorIds = [
    ...new Set(
      ((logs ?? []) as Array<{ actor_type: string | null; actor_id: string | null }>)
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

  const totalCount = count ?? 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const hasFilters = project || table || actorType || from || to

  function pageUrl(p: number) {
    const sp = new URLSearchParams()
    if (project) sp.set('project', project)
    if (table) sp.set('table', table)
    if (actorType) sp.set('actor_type', actorType)
    if (from) sp.set('from', from)
    if (to) sp.set('to', to)
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return qs ? `/activity?${qs}` : '/activity'
  }

  function displayActor(aType: string | null, aId: string | null): string {
    if (!aType || aType === 'system') return 'System'
    if (aType === 'ai') return 'AI'
    if (aType === 'user' && aId) return actorEmails[aId] ?? aId.slice(0, 8) + '…'
    return 'Unknown'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = logs ?? []

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Suspense>
          <ActivityFilters
            projects={projects ?? []}
            project={project}
            table={table}
            actorType={actorType}
            from={from}
            to={to}
          />
        </Suspense>
        <span className="text-xs text-muted-foreground shrink-0">
          {totalCount.toLocaleString()} event{totalCount !== 1 ? 's' : ''}
          {hasFilters ? ' matching' : ''}
        </span>
      </div>

      {/* Log */}
      {rows.length > 0 ? (
        <>
          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-2">
            {rows.map((log) => {
              const proj = log.projects as { id: string; name: string } | null
              const link = recordLink(log.table_name, log.record_id, log.project_id)
              const actionStyle = ACTION_STYLES[log.action] ?? 'bg-slate-50 dark:bg-slate-950/40 text-slate-600 dark:text-slate-400 ring-slate-200 dark:ring-slate-800/60'
              return (
                <div key={log.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${actionStyle}`}
                    >
                      {log.action}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {formatTs(log.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {TABLE_LABELS[log.table_name] ?? log.table_name}
                    </span>
                    {proj && (
                      <Link href={`/projects/${proj.id}`} className="text-xs text-foreground/70 hover:underline truncate max-w-[50%] text-right">
                        {proj.name}
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {displayActor(log.actor_type, log.actor_id)}
                    </span>
                    {link && (
                      <Link
                        href={link}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        View →
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Time
                  </th>
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Action
                  </th>
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Table
                  </th>
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Project
                  </th>
                  <th className="py-2 px-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Actor
                  </th>
                  <th className="py-2 px-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((log) => {
                  const proj = log.projects as { id: string; name: string } | null
                  const link = recordLink(log.table_name, log.record_id, log.project_id)
                  const actionStyle = ACTION_STYLES[log.action] ?? 'bg-slate-50 dark:bg-slate-950/40 text-slate-600 dark:text-slate-400 ring-slate-200 dark:ring-slate-800/60'
                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
                        {formatTs(log.created_at)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold uppercase ring-1 ring-inset ${actionStyle}`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-foreground whitespace-nowrap">
                        {TABLE_LABELS[log.table_name] ?? log.table_name}
                      </td>
                      <td className="py-2 px-3 text-foreground max-w-[180px] truncate">
                        {proj ? (
                          <Link href={`/projects/${proj.id}`} className="hover:underline">
                            {proj.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground max-w-[160px] truncate">
                        {displayActor(log.actor_type, log.actor_id)}
                      </td>
                      <td className="py-2 px-3">
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
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-card flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">
            No activity{hasFilters ? ' matching these filters' : ' recorded yet'}
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
          <span>
            Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, totalCount).toLocaleString()} of {totalCount.toLocaleString()} events
          </span>
          <div className="flex items-center gap-2">
            {page > 1 && (
              <Link
                href={pageUrl(page - 1)}
                className="h-8 px-3 rounded-md border border-input bg-background hover:bg-accent transition-colors inline-flex items-center text-xs font-medium"
              >
                ← Previous
              </Link>
            )}
            <span className="px-2 tabular-nums">
              {page} / {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={pageUrl(page + 1)}
                className="h-8 px-3 rounded-md border border-input bg-background hover:bg-accent transition-colors inline-flex items-center text-xs font-medium"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
