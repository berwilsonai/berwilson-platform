import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Building2,
  ChevronLeft,
  ExternalLink,
  Mail,
  Phone,
  Star,
  User,
} from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS } from '@/lib/utils/stages'
import type { ProjectSector, ProjectStage } from '@/lib/supabase/types'
import ContactTabBar from '@/components/contacts/ContactTabBar'
import RelationshipNotesEditor from '@/components/contacts/RelationshipNotesEditor'
import AvatarUpload from '@/components/contacts/AvatarUpload'
import LinkedInEditor from '@/components/contacts/LinkedInEditor'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

const VALID_TABS = ['overview', 'projects', 'activity', 'notes']

export default async function ContactDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { tab: rawTab } = await searchParams
  const tab = VALID_TABS.includes(rawTab ?? '') ? (rawTab ?? 'overview') : 'overview'

  const supabase = createAdminClient()

  const { data: party } = await supabase
    .from('parties')
    .select('*')
    .eq('id', id)
    .single()

  if (!party) notFound()

  // ─── Overview tab data ────────────────────────────────────────────────────
  let projectCount = 0
  let lastActive: string | null = null
  let teamMembers: Array<{ id: string; full_name: string; title: string | null; email: string | null }> = []

  if (tab === 'overview') {
    const { data: players } = await supabase
      .from('project_players')
      .select('project_id, projects(updated_at)')
      .eq('party_id', id)

    projectCount = players?.length ?? 0
    lastActive = (players ?? []).reduce<string | null>((max, pp) => {
      const proj = pp.projects as { updated_at: string | null } | null
      const d = proj?.updated_at ?? null
      if (!d) return max
      return !max || d > max ? d : max
    }, null)

    // Company grouping
    const companySearch = party.is_organization ? party.full_name : party.company
    if (companySearch) {
      const { data: team } = await supabase
        .from('parties')
        .select('id, full_name, title, email')
        .eq('company', companySearch)
        .neq('id', id)
        .order('full_name')
      teamMembers = team ?? []
    }
  }

  // ─── Projects tab data ────────────────────────────────────────────────────
  type PlayerWithProject = {
    id: string
    role: string
    is_primary: boolean | null
    notes: string | null
    projects: {
      id: string
      name: string
      sector: string
      stage: string
      status: string
    } | null
  }
  let playerRows: PlayerWithProject[] = []

  if (tab === 'projects') {
    const { data } = await supabase
      .from('project_players')
      .select('id, role, is_primary, notes, projects(id, name, sector, stage, status)')
      .eq('party_id', id)
      .order('created_at', { ascending: false })
    playerRows = (data as PlayerWithProject[]) ?? []
  }

  // ─── Activity tab data ────────────────────────────────────────────────────
  type UpdateRow = {
    id: string
    summary: string | null
    created_at: string | null
    source: string
    projects: { name: string } | null
  }
  type DdRow = {
    id: string
    item: string
    category: string
    status: string
    severity: string
    created_at: string | null
    projects: { name: string } | null
  }
  type ComplianceRow = {
    id: string
    requirement: string
    framework: string
    status: string
    due_date: string | null
    projects: { name: string } | null
  }

  let activityUpdates: UpdateRow[] = []
  let ddItems: DdRow[] = []
  let complianceItems: ComplianceRow[] = []

  if (tab === 'activity') {
    // Updates for projects this party is involved in
    const { data: playerLinks } = await supabase
      .from('project_players')
      .select('project_id')
      .eq('party_id', id)

    const projectIds = (playerLinks ?? []).map(p => p.project_id)

    if (projectIds.length > 0) {
      const { data: updates } = await supabase
        .from('updates')
        .select('id, summary, created_at, source, projects(name)')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(30)
      activityUpdates = (updates as UpdateRow[]) ?? []
    }

    // Also try to find updates that mention this party by name in mentioned_parties JSONB
    if (party.full_name) {
      const { data: mentionUpdates } = await supabase
        .from('updates')
        .select('id, summary, created_at, source, projects(name)')
        .filter('mentioned_parties::text', 'ilike', `%${party.full_name.replace(/'/g, "''")}%`)
        .not('project_id', 'in', `(${projectIds.length > 0 ? projectIds.join(',') : 'null'})`)
        .order('created_at', { ascending: false })
        .limit(20)

      if (mentionUpdates && mentionUpdates.length > 0) {
        activityUpdates = [...activityUpdates, ...(mentionUpdates as UpdateRow[])]
      }
    }

    // DD items assigned to this party
    const { data: dd } = await supabase
      .from('dd_items')
      .select('id, item, category, status, severity, created_at, projects(name)')
      .eq('assigned_to', id)
      .order('created_at', { ascending: false })
    ddItems = (dd as DdRow[]) ?? []

    // Compliance items
    const { data: compliance } = await supabase
      .from('compliance_items')
      .select('id, requirement, framework, status, due_date, projects(name)')
      .eq('responsible_party', id)
      .order('created_at', { ascending: false })
    complianceItems = (compliance as ComplianceRow[]) ?? []
  }

  // ─── Notes tab data ───────────────────────────────────────────────────────
  type ActivityLogRow = {
    id: string
    action: string
    actor_type: string | null
    created_at: string | null
    metadata: unknown
  }
  let activityLog: ActivityLogRow[] = []

  if (tab === 'notes') {
    const { data: log } = await supabase
      .from('activity_log')
      .select('id, action, actor_type, created_at, metadata')
      .eq('record_id', id)
      .eq('table_name', 'parties')
      .order('created_at', { ascending: false })
      .limit(50)
    activityLog = (log as ActivityLogRow[]) ?? []
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const displayTitle =
    party.title && party.company
      ? `${party.title} · ${party.company}`
      : party.title ?? party.company ?? null

  return (
    <div className="space-y-0">
      {/* Breadcrumb */}
      <div className="pb-5 space-y-3">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={13} />
          Contacts
        </Link>

        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <AvatarUpload
              partyId={id}
              avatarUrl={party.avatar_url}
              isOrganization={party.is_organization}
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight">{party.full_name}</h1>
            {displayTitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{displayTitle}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <ContactTabBar contactId={id} activeTab={tab} />

      {/* Tab content */}
      <div className="pt-6">
        {/* ── OVERVIEW ─────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: contact info + notes */}
            <div className="lg:col-span-2 space-y-6">
              {/* Contact info */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Contact Info
                </h2>
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  {party.email && (
                    <div className="flex items-center gap-2.5">
                      <Mail size={14} className="text-muted-foreground shrink-0" />
                      <a
                        href={`mailto:${party.email}`}
                        className="text-sm hover:underline"
                      >
                        {party.email}
                      </a>
                    </div>
                  )}
                  {party.phone && (
                    <div className="flex items-center gap-2.5">
                      <Phone size={14} className="text-muted-foreground shrink-0" />
                      <a href={`tel:${party.phone}`} className="text-sm hover:underline">
                        {party.phone}
                      </a>
                    </div>
                  )}
                  {/* LinkedIn URL */}
                  <LinkedInEditor
                    partyId={id}
                    initialUrl={party.linkedin_url}
                  />
                  {!party.email && !party.phone && !party.linkedin_url && (
                    <p className="text-sm text-muted-foreground italic">No contact details on file.</p>
                  )}
                </div>
              </section>

              {/* Relationship notes */}
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Relationship Notes
                </h2>
                <div className="rounded-lg border border-border bg-card p-4">
                  <RelationshipNotesEditor
                    partyId={id}
                    initialNotes={party.relationship_notes}
                  />
                </div>
              </section>

              {/* Team / co-workers */}
              {teamMembers.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    {party.is_organization ? 'Team' : `Others at ${party.company}`}
                  </h2>
                  <div className="rounded-lg border border-border bg-card divide-y divide-border">
                    {teamMembers.map(member => (
                      <Link
                        key={member.id}
                        href={`/contacts/${member.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <User size={13} className="text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{member.full_name}</p>
                          {member.title && (
                            <p className="text-xs text-muted-foreground truncate">{member.title}</p>
                          )}
                        </div>
                        {member.email && (
                          <span className="ml-auto text-xs text-muted-foreground truncate hidden sm:block">
                            {member.email}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Right: quick stats */}
            <div className="space-y-4">
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Quick Stats
                </h2>
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Projects</span>
                    <span className="text-sm font-semibold">{projectCount}</span>
                  </div>
                  {lastActive && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Last Active</span>
                      <span className="text-xs">
                        {new Date(lastActive).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Type</span>
                    <span className="text-xs">
                      {party.is_organization ? 'Organization' : 'Individual'}
                    </span>
                  </div>
                </div>
              </section>

              <Link
                href={`/contacts/${id}?tab=projects`}
                className="block rounded-lg border border-border bg-card p-4 hover:bg-muted/50 transition-colors text-center text-xs text-muted-foreground"
              >
                View all {projectCount} project{projectCount !== 1 ? 's' : ''} →
              </Link>
            </div>
          </div>
        )}

        {/* ── PROJECTS ─────────────────────────────────────── */}
        {tab === 'projects' && (
          <div>
            {playerRows.length === 0 ? (
              <div className="py-20 text-center text-sm text-muted-foreground">
                Not linked to any projects yet.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                        Project
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">
                        Sector
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">
                        Stage
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                        Role
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {playerRows.map(row => {
                      const project = row.projects
                      if (!project) return null
                      return (
                        <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <Link
                              href={`/projects/${project.id}/players`}
                              className="font-medium hover:underline"
                            >
                              {project.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span
                              className={cn(
                                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                                SECTOR_BADGE[project.sector as ProjectSector]
                              )}
                            >
                              {SECTOR_LABELS[project.sector as ProjectSector]}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <span className="text-xs text-muted-foreground">
                              {STAGE_LABELS[project.stage as ProjectStage]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                                {row.role}
                              </span>
                              {row.is_primary && (
                                <Star
                                  size={11}
                                  className="text-amber-500 fill-amber-400"
                                  aria-label="Primary contact"
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ACTIVITY ─────────────────────────────────────── */}
        {tab === 'activity' && (
          <div className="space-y-6">
            {/* Updates */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Updates
              </h2>
              {activityUpdates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No updates found.</p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {activityUpdates.map(u => {
                    const proj = u.projects as { name: string } | null
                    return (
                      <div key={u.id} className="px-4 py-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          {proj && (
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {proj.name}
                            </span>
                          )}
                          {u.created_at && (
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {new Date(u.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          )}
                        </div>
                        <p className="text-sm">
                          {u.summary ?? <span className="text-muted-foreground italic">No summary</span>}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* DD items */}
            {ddItems.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Due Diligence Items Assigned
                </h2>
                <div className="rounded-lg border border-border divide-y divide-border">
                  {ddItems.map(item => {
                    const proj = item.projects as { name: string } | null
                    return (
                      <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{item.item}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground">{item.category}</span>
                            {proj && (
                              <span className="text-[10px] text-muted-foreground">· {proj.name}</span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {item.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Compliance items */}
            {complianceItems.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Compliance Responsibilities
                </h2>
                <div className="rounded-lg border border-border divide-y divide-border">
                  {complianceItems.map(item => {
                    const proj = item.projects as { name: string } | null
                    return (
                      <div key={item.id} className="px-4 py-3 flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{item.requirement}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground">{item.framework}</span>
                            {proj && (
                              <span className="text-[10px] text-muted-foreground">· {proj.name}</span>
                            )}
                            {item.due_date && (
                              <span className="text-[10px] text-muted-foreground">
                                · Due {new Date(item.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {item.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {activityUpdates.length === 0 && ddItems.length === 0 && complianceItems.length === 0 && (
              <p className="py-20 text-center text-sm text-muted-foreground">
                No activity on record for this contact.
              </p>
            )}
          </div>
        )}

        {/* ── NOTES ────────────────────────────────────────── */}
        {tab === 'notes' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Relationship Notes
                </h2>
                <div className="rounded-lg border border-border bg-card p-4">
                  <RelationshipNotesEditor
                    partyId={id}
                    initialNotes={party.relationship_notes}
                  />
                </div>
              </section>
            </div>

            <div>
              {activityLog.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Edit History
                  </h2>
                  <div className="space-y-2">
                    {activityLog.map(entry => (
                      <div key={entry.id} className="rounded-md border border-border bg-card px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium capitalize">{entry.action.toLowerCase()}</span>
                          {entry.created_at && (
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(entry.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">
                          {entry.actor_type ?? 'user'}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
