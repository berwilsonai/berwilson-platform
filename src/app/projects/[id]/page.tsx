import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink, Layers, ChevronRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createAdminClient } from '@/lib/supabase/admin'
import ProjectNarrativeBrief from '@/components/projects/ProjectNarrativeBrief'
import MediaGallery from '@/components/shared/MediaGallery'
import DependenciesTab from '@/components/projects/DependenciesTab'
import type { Entity, EntityProject, Project } from '@/lib/supabase/types'
import type { Metadata } from 'next'
import {
  SECTOR_BADGE, SECTOR_SHORT, STAGE_LABELS,
  ENTITY_TYPE_LABELS, ENTITY_TYPE_BADGE, RELATIONSHIP_LABELS,
  ACTIVITY_TABLE_LABELS, ACTIVITY_ACTION_STYLES,
  FEDERAL_STANDARD_LABELS, FEDERAL_STANDARD_DESCRIPTIONS, FEDERAL_STANDARD_BADGE,
  formatValue, parseCompetitors, enumLabel,
  type FederalStandard,
} from '@/lib/utils/constants'
import PursuitSnapshot from '@/components/projects/PursuitSnapshot'
import InlineField from '@/components/projects/InlineField'
import { coverageNote, pipelineTotal, pipelineValue } from '@/lib/records/pipeline-value'
import DiligenceChecklist from '@/components/dataroom/DiligenceChecklist'
import { readRoomStatus } from '@/lib/dataroom/status'
import PowerRamp from '@/components/records/PowerRamp'
import { readRecordPhases } from '@/lib/records/power-read'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase.from('projects').select('name').eq('id', id).single()
  return { title: data?.name ? `${data.name} — Ber Wilson Intelligence` : 'Project — Ber Wilson Intelligence' }
}

type EntityProjectWithEntity = EntityProject & { entity: Entity }

/**
 * A value an `InlineField` is wrapping, or "Not set" in words.
 *
 * ⚠ THIS REPLACED A `Field` COMPONENT THAT RENDERED NOTHING WHEN EMPTY, and
 * the reasoning is worth keeping because both halves are §12 rules and they
 * point opposite ways. `Field` omitted an empty row because a bare em dash at
 * a value's own weight reads as a failed render — correct for a fact somebody
 * is READING. It inverts for a field somebody is FILLING: an absent row is an
 * absent door, which is the rule about a surface hidden because it is empty
 * being hidden exactly when somebody needs to fill it. So the absence is named
 * in words instead, which is the other half of the same §12 line — omit the
 * row, OR name the absence. Every row here is now a door, so every row names
 * its absence.
 */
function InlineValue({ text }: { text: string | null | undefined }) {
  return text
    ? <span className="text-sm text-foreground">{text}</span>
    : <span className="text-sm text-muted-foreground">Not set</span>
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

  const [{ data: project }, { data: activityLogs }, { data: entityLinksRaw }, { data: childProjects }, { data: projectPhotos }, { data: allProjectsRaw }, { data: storedBrief }] = await Promise.all([
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
    supabase
      .from('projects')
      .select('id, name')
      .eq('status', 'active')
      .order('name'),
    // The brief the platform already wrote. Read here rather than left to the
    // browser's own localStorage — see ProjectNarrativeBrief.
    supabase
      .from('stored_briefs')
      .select('content, created_at')
      .eq('project_id', id)
      .eq('brief_type', 'project')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!project) notFound()

  // The record's own phases, for the editor. The rolled-up TOTAL is computed
  // in the layout (one place, so the header and /projects cannot disagree);
  // this is the schedule itself, which is always the record's own.
  const rampPhases = await readRecordPhases('project', id)

  /**
   * The diligence checklist, for the collapsed card at the top of the left
   * column. ⚠ Caught rather than thrown: a database hiccup must cost one card,
   * never the whole Overview — and `readRoomStatus` returns null for a record
   * that is not on the data-room template, which is the normal case for 17 of
   * the 33 records.
   */
  const room = project.data_room_template === 'data_center'
    ? await readRoomStatus('project', id).catch(() => null)
    : null

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
  const hasPhotos = (projectPhotos ?? []).length > 0

  function displayActor(log: { actor_type: string | null; actor_id: string | null; actor_email?: string | null }): string {
    if (!log.actor_type || log.actor_type === 'system') return 'System'
    if (log.actor_type === 'ai') return 'AI'
    if (log.actor_type === 'user') return log.actor_email ?? (log.actor_id ? log.actor_id.slice(0, 8) + '…' : 'User')
    return 'Unknown'
  }

  return (
    <div className="space-y-6">
      {/* Parent breadcrumb for child projects */}
      {parentProject && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers size={12} className="text-violet-500 dark:text-violet-400" />
          <span>Part of</span>
          <Link
            href={`/projects/${parentProject.id}`}
            className="font-medium text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 transition-colors"
          >
            {parentProject.name}
          </Link>
        </div>
      )}

      {/*
        Site photos lead the page when there ARE any — a project with photos
        should open with them. An EMPTY dropzone leading the page is 140px of
        nothing ranked above the brief, so when there are none the gallery
        moves to the foot of the column and the reader meets the brief first.
      */}
      {hasPhotos && (
        <MediaGallery
          initialPhotos={projectPhotos ?? []}
          scope={{ projectId: id }}
        />
      )}

      {/* ⚠ NO ACTION ROW HERE. Edit / Brief / Protect and the Log menu live in
          the record header (`projects/[id]/layout.tsx`), so they are reachable
          from every tab rather than only this one. Do not re-add them. */}

      {/* Two-column: detail (left) + pursuit snapshot rail (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
        <div className="space-y-8 min-w-0">

      {/*
        THE DILIGENCE CHECKLIST, COLLAPSED, ABOVE THE BRIEF.

        Richard, 10-30: *"The checklist is a really important part of each
        project. I would like it towards the top."* On the Overview that means
        the first thing in the left column — above the narrative brief, which is
        prose somebody reads once, where this is the thing they come back to.
        Collapsed to its heading and bar by default so it costs four lines until
        somebody wants the nineteen; the full surface is one click away and the
        heading says so.

        ⚠ Only for a record on the data-room template. A 0/19 bar on a plumbing
        acquisition is a scheme that does not apply there announcing itself as a
        failure.
      */}
      {room ? (
        <DiligenceChecklist
          status={room}
          collapsible
          defaultOpen={false}
          href={`/projects/${id}/data-room`}
        />
      ) : null}

      {/* Narrative brief — AI-generated executive summary */}
      <ProjectNarrativeBrief
        projectId={id}
        initialBrief={
          storedBrief ? { content: storedBrief.content, createdAt: storedBrief.created_at } : null
        }
      />

      {/*
        Description.

        ⚠ IT IS SHOWN WHETHER OR NOT THERE IS ONE, which is a reversal. The
        section was gated on `project.description` — right for reading, wrong
        for writing, and §12 names exactly this: a surface hidden because it is
        empty is hidden exactly when somebody needs to fill it. An empty
        description was only reachable through the Edit form, which is the trip
        this change removes.
      */}
      <section className="space-y-2">
        <InlineField
          projectId={id}
          field="description"
          value={project.description}
          display={
            project.description ? (
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                {project.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description yet — double-click to write one.
              </p>
            )
          }
        />
      </section>

      {/*
        Contract & value.

        ⚠ EVERY ROW IS EDITABLE, AND EVERY ROW IS PRESENT (Richard, 10-30:
        *"Make all those fields editable on a project by double clicking"*).
        `Field` above renders nothing when there is no value, which is the
        right call for a fact somebody is reading and the wrong one for a field
        somebody is filling — so these six go through `InlineField`, which says
        "Not set" in words and carries its own editor. `Field` is still used
        for the derived rows further down, which nobody can type into.
      */}
      <section className="space-y-3">
        <h2 className="label-caps text-muted-foreground">
          Contract
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
          {/* ⚠ THE VALUE IS LABELLED BY WHICH QUANTITY IT IS — an unlabelled
              numeric column once held $57.5B of plainly different quantities
              (§12). `pipelineValue` names it; the editor writes the one
              column that actually exists behind it. */}
          <InlineField
            projectId={id}
            field="estimated_value"
            value={project.estimated_value}
            display={
              pipelineValue(project).amount != null
                ? <span className="text-sm tnum text-foreground">{formatValue(pipelineValue(project).amount)}</span>
                : <span className="text-sm text-muted-foreground">Not set</span>
            }
          />
          <InlineField
            projectId={id}
            field="contract_type"
            value={project.contract_type}
            display={<InlineValue text={enumLabel(project.contract_type, undefined, { empty: '' })} />}
          />
          <InlineField
            projectId={id}
            field="delivery_method"
            value={project.delivery_method}
            display={<InlineValue text={enumLabel(project.delivery_method, undefined, { empty: '' })} />}
          />
          <InlineField
            projectId={id}
            field="client_entity"
            value={project.client_entity}
            display={<InlineValue text={project.client_entity} />}
          />
          <InlineField
            projectId={id}
            field="location"
            value={project.location}
            display={<InlineValue text={project.location} />}
          />
          <InlineField
            projectId={id}
            field="solicitation_number"
            value={project.solicitation_number}
            display={<InlineValue text={project.solicitation_number} />}
          />
        </dl>
      </section>

      {/*
        The ramp-up schedule.

        ⚠ IT SITS ON THE OVERVIEW AND NOT BEHIND A TAB, because the total it
        produces is the key metric (Richard, 10-30) and the editor is the only
        door to it. A tab would put the platform's most important number one
        click further away than the solicitation number above it.

        ⚠ AND IT IS RENDERED WHETHER OR NOT THERE IS A SCHEDULE — §12: a surface
        hidden because it is empty is hidden exactly when somebody needs to fill
        it. Sixteen power deals have nothing here yet, and count-gating would
        hide the button from every one of them.
      */}
      <section>
        <PowerRamp kind="project" recordId={id} phases={rampPhases} />
      </section>

      {/* Sub-Projects (for programs) */}
      {isProgram && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="label-caps text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Layers size={12} className="text-violet-500 dark:text-violet-400" />
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
                    'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
                    SECTOR_BADGE[child.sector]
                  )}
                >
                  {SECTOR_SHORT[child.sector]}
                </span>
                <span className="text-sm font-medium text-foreground flex-1 truncate group-hover:text-info dark:group-hover:text-info transition-colors">
                  {child.name}
                </span>
                {child.stage && (
                  <span className="text-xs text-muted-foreground hidden sm:block shrink-0">
                    {STAGE_LABELS[child.stage]}
                  </span>
                )}
                <span
                  className="text-sm font-semibold tnum text-foreground shrink-0"
                  title={pipelineValue(child).hint}
                >
                  {formatValue(pipelineValue(child).amount)}
                </span>
                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
          {/* ⚠ Names how much of the program the aggregate covers. A total over
              two of six priced sub-projects is not the program's value, and the
              reader cannot tell that from the figure alone. */}
          {(() => {
            // ⚠ THE SUB-PROJECTS ONLY — NOT THE PROGRAM ALONGSIDE THEM. This
            // read `[project, ...children]`, so a program carrying its own
            // figure was added to the figures of the work inside it and the
            // aggregate came out roughly double. Latent only because
            // `parent_project_id` was used by 0 of 14 rows. A deal's value
            // lives on leaves; a program's is what the work inside adds up to.
            const total = pipelineTotal(childProjects ?? [])
            const note = coverageNote(total)
            const own = pipelineValue(project)
            return (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>
                  Aggregated value:{' '}
                  <span className="font-semibold tnum text-foreground">
                    {total.estimated > 0 ? formatValue(total.amount) : 'Not set'}
                  </span>
                  {note ? <span> · {note}</span> : null}
                </div>
                {/* Ignoring a number and saying you ignored it are different
                    acts (§12). Without this line the next person to put a
                    figure on the program wonders why it never appeared. */}
                {own.amount != null ? (
                  <div>
                    The program also carries {formatValue(own.amount)} of its own (
                    {own.definition.toLowerCase()}), which is not added here — it would count the
                    same work twice.
                  </div>
                ) : null}
              </div>
            )
          })()}
        </section>
      )}

      {/*
        Competitive landscape.

        ⚠ THE SECTION IS ALWAYS PRESENT NOW, and the two editable fields inside
        it always are too. It was gated on there being an incumbent, a
        competitor or a strategy — so on a deal with none of the three there
        was no door to record the first one (§12). `competitors` keeps its own
        count gate: it is a jsonb array with its own editor on the Edit form,
        not an inline field, so an empty list has nothing to offer here.
      */}
      {(() => {
        const p = project as typeof project & { incumbent?: string | null; competitors?: unknown; win_strategy?: string | null }
        const competitors = parseCompetitors(p.competitors)
        return (
          <section className="space-y-3">
            <h2 className="label-caps text-muted-foreground">
              Competitive Landscape
            </h2>
            <div className="rounded-lg border border-border p-4 space-y-4">
              <InlineField
                projectId={id}
                field="incumbent"
                value={p.incumbent}
                display={<InlineValue text={p.incumbent} />}
              />
              {competitors.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                    Known Competitors
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {competitors.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center rounded-full bg-muted dark:bg-muted/40 text-foreground dark:text-muted-foreground ring-1 ring-inset ring-border dark:ring-border/60 px-2 py-0.5 text-xs font-medium"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <InlineField
                projectId={id}
                field="win_strategy"
                value={p.win_strategy}
                display={
                  p.win_strategy ? (
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{p.win_strategy}</p>
                  ) : (
                    <span className="text-sm text-muted-foreground">Not set</span>
                  )
                }
              />
            </div>
          </section>
        )
      })()}

      {/* Federal Standards */}
      {(() => {
        const standards = (project.applicable_standards ?? ['usace_qm', 'dod_385']) as FederalStandard[]
        if (!standards || standards.length === 0) return null
        return (
          <section className="space-y-3">
            <h2 className="label-caps text-muted-foreground">
              Applicable Federal Standards
            </h2>
            <div className="space-y-2">
              {standards.map((std) => (
                <div
                  key={std}
                  className="flex items-start gap-3 rounded-lg border border-border p-3"
                >
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset mt-0.5',
                      FEDERAL_STANDARD_BADGE[std] ?? 'bg-muted dark:bg-muted/40 text-muted-foreground ring-border dark:ring-border/60'
                    )}
                  >
                    {std === 'usace_qm' ? 'USACE QM' : 'DoD 385'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{FEDERAL_STANDARD_LABELS[std]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {FEDERAL_STANDARD_DESCRIPTIONS[std]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              All vendors and contractors on this project will be scored against these standards.
            </p>
          </section>
        )
      })()}

      {/* Corporate entities */}
      {entityLinks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="label-caps text-muted-foreground">
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
                    'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
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
                  <span className="text-xs font-medium text-foreground shrink-0 tnum">
                    {ep.equity_pct}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cross-Project Dependencies */}
      <section className="space-y-3">
        <DependenciesTab
          projectId={id}
          projectName={project.name}
          allProjects={(allProjectsRaw ?? []).map(p => ({ id: p.id, name: p.name }))}
        />
      </section>

      {/*
        The audit log — WHO CHANGED WHAT on the record, not what happened on
        the deal. Named "Change History" because "Recent Activity" collided
        with the Updates tab, which is where a human reads what has actually
        happened: two surfaces called activity meaning different things, which
        is the one-quantity-one-definition rule (§12).
      */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="label-caps text-muted-foreground">
            Change History
          </h2>
          <Link
            href={`/activity?project=${id}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </Link>
        </div>
        {/* overflow-x-AUTO, not hidden: five columns, three of them
            whitespace-nowrap behind a fixed w-36 and w-20, so on a phone the
            actor and the open-record link were clipped with no way to reach
            them. Same min-width as the full /activity table. */}
        {typedLogs.length > 0 ? (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <tbody className="divide-y divide-border">
                {typedLogs.map((log) => {
                  const link = activityRecordLink(log.table_name, log.record_id, id)
                  const actionStyle = ACTIVITY_ACTION_STYLES[log.action] ?? 'bg-muted dark:bg-muted/40 text-muted-foreground ring-border dark:ring-border/60'
                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap w-36">
                        {formatActivityTs(log.created_at)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap w-20">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold uppercase ring-1 ring-inset ${actionStyle}`}
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
                              <span key={field} className="text-xs text-foreground/70">
                                {field}: <span className="line-through text-critical/70">{String(change.old ?? '—')}</span> → <span className="text-positive">{String(change.new ?? '—')}</span>
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

      {/* Photos — see the note above; only reached when the project has none. */}
      {!hasPhotos && (
        <MediaGallery
          initialPhotos={[]}
          scope={{ projectId: id }}
        />
      )}

        </div>{/* end left column */}

        {/* Pursuit snapshot rail */}
        <PursuitSnapshot project={project} />
      </div>{/* end two-column grid */}
    </div>
  )
}
