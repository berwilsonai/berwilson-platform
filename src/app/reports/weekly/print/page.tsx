import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatDate } from '@/lib/utils/constants'
import {
  OBJECTIVE_BUCKET_LABELS,
  OBJECTIVE_HEALTH_LABELS,
  objectiveHealth,
} from '@/lib/utils/objectives'
import { WeeklyPrintToolbar } from '@/components/reports/WeeklyPrintToolbar'
import { PreparedDate } from '@/components/objectives/PrintToolbar'

/**
 * The weekly report — the artifact that goes out to a team who can't reach the
 * platform. It is deliberately organized objective → person → handoff, not by
 * project: priority then becomes mechanical (anything under a Now objective)
 * instead of a judgment call every Monday.
 *
 * `?person=<id>` narrows it to one teammate's page, which is what actually gets
 * emailed to them. Admin-only by default-deny — /reports is in no permissions
 * allowlist. Printing is the browser's print dialog; no PDF library.
 */

interface PageProps {
  searchParams: Promise<{ person?: string }>
}

interface ReportTask {
  id: string
  title: string
  status: string
  due_date: string | null
  completed_at: string | null
  objective_id: string | null
  assignee_id: string | null
  waiting_on_id: string | null
  waiting_on_what: string | null
  waiting_on_since: string | null
  assignee: { id: string; name: string } | null
  blocker: { id: string; name: string } | null
  project: { id: string; name: string } | null
}

interface ReportObjective {
  id: string
  title: string
  bucket: string
  health: string
  target_date: string | null
  owner: { name: string } | null
}

const TASK_SELECT =
  'id, title, status, due_date, completed_at, objective_id, assignee_id, waiting_on_id, waiting_on_what, waiting_on_since, ' +
  // Two FKs point at team_members, so PostgREST needs the constraint name to disambiguate.
  'assignee:team_members!tasks_assignee_id_fkey(id, name), ' +
  'blocker:team_members!tasks_waiting_on_id_fkey(id, name), ' +
  'project:projects(id, name)'

/** Local calendar day — toISOString() would roll over the date after 5pm in Utah. */
function dayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return dayString(d)
}

function ageInDays(since: string | null): number | null {
  if (!since) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(
    0,
    Math.round((today.getTime() - new Date(`${since}T00:00:00`).getTime()) / 86_400_000),
  )
}

export async function generateMetadata({ searchParams }: PageProps) {
  const { person } = await searchParams
  let who = ''
  if (person) {
    const { data } = await createAdminClient()
      .from('team_members')
      .select('name')
      .eq('id', person)
      .maybeSingle()
    if (data?.name) who = ` — ${data.name}`
  }
  // The tab title becomes the browser's suggested PDF filename.
  return { title: `Ber Wilson — Week of ${formatDate(dayString(new Date()))}${who}` }
}

export default async function WeeklyReportPrintPage({ searchParams }: PageProps) {
  const { person } = await searchParams
  const supabase = createAdminClient()

  const today = dayString(new Date())
  const weekAhead = shiftDays(7)
  const twoWeeksAhead = shiftDays(14)
  const weekAgo = shiftDays(-7)

  const [{ data: taskRows }, { data: objectiveRows }, { data: memberRows }, { data: milestoneRows }, { data: bidRows }] =
    await Promise.all([
      // Everything open, plus what closed in the last week (the "progress" section).
      supabase
        .from('tasks')
        .select(TASK_SELECT)
        .or(`status.eq.open,completed_at.gte.${weekAgo}`)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('objectives')
        .select('id, title, bucket, health, target_date, owner:team_members(name)')
        .eq('status', 'active')
        .order('sort_order', { ascending: true }),
      supabase
        .from('team_members')
        .select('id, name')
        .eq('active', true)
        .order('created_at', { ascending: true }),
      supabase
        .from('milestones')
        .select('id, title, target_date, project:projects(name)')
        .is('completed_at', null)
        .not('target_date', 'is', null)
        .lte('target_date', twoWeeksAhead)
        .order('target_date', { ascending: true }),
      supabase
        .from('projects')
        .select('id, name, bid_due_date')
        .not('bid_due_date', 'is', null)
        .gte('bid_due_date', today)
        .lte('bid_due_date', twoWeeksAhead)
        .order('bid_due_date', { ascending: true }),
    ])

  const tasks = (taskRows ?? []) as unknown as ReportTask[]
  const objectives = (objectiveRows ?? []) as unknown as ReportObjective[]
  const members = (memberRows ?? []) as { id: string; name: string }[]
  const milestones = (milestoneRows ?? []) as unknown as {
    id: string
    title: string
    target_date: string
    project: { name: string } | null
  }[]
  const bids = (bidRows ?? []) as { id: string; name: string; bid_due_date: string }[]

  const focus = person ? members.find((m) => m.id === person) ?? null : null
  const openTasks = tasks.filter((t) => t.status !== 'done')

  // ── Objectives: the priority spine. Task counts hang off the objective tag.
  const objectiveLines = objectives.map((o) => {
    const own = openTasks.filter((t) => t.objective_id === o.id)
    return {
      ...o,
      open: own.length,
      overdue: own.filter((t) => t.due_date && t.due_date < today).length,
    }
  })
  const nowObjectives = objectiveLines.filter((o) => o.bucket === 'now')
  const soonObjectives = objectiveLines.filter((o) => o.bucket === 'soon')

  // ── Handoffs: who owes whom. Oldest first — age is the whole point.
  const allHandoffs = openTasks
    .filter((t) => t.waiting_on_id)
    .sort((a, b) => (a.waiting_on_since ?? '').localeCompare(b.waiting_on_since ?? ''))
  const handoffs = focus
    ? allHandoffs.filter((t) => t.waiting_on_id === focus.id || t.assignee_id === focus.id)
    : allHandoffs

  // ── Per-person pages. With ?person=, the document is just theirs.
  const people = (focus ? [focus] : members).map((m) => {
    const mine = openTasks.filter((t) => t.assignee_id === m.id)
    return {
      member: m,
      overdue: mine.filter((t) => t.due_date && t.due_date < today),
      dueThisWeek: mine.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekAhead),
      noDate: mine.filter((t) => !t.due_date),
      owes: openTasks.filter((t) => t.waiting_on_id === m.id),
      blockedOn: mine.filter((t) => t.waiting_on_id),
    }
  })

  const closedLastWeek = tasks.filter(
    (t) =>
      t.status === 'done' &&
      t.completed_at &&
      t.completed_at >= weekAgo &&
      (!focus || t.assignee_id === focus.id),
  )

  const taskLine = (t: ReportTask) => (
    <>
      {t.title}
      {t.project && <span className="text-slate-500"> · {t.project.name}</span>}
    </>
  )

  return (
    <div className="min-h-full bg-white text-slate-900">
      <WeeklyPrintToolbar people={members} selected={focus?.id ?? 'all'} />

      <div className="mx-auto max-w-3xl px-8 py-10 print:max-w-none print:px-0 print:py-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-4 pb-6 border-b-2 border-slate-900">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              The Week
              {focus && <span className="text-slate-500"> — {focus.name}</span>}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Ber Wilson · Prepared <PreparedDate />
            </p>
          </div>
          <Image src="/logo.png" alt="Ber Wilson" width={120} height={65} className="object-contain h-9 w-auto" />
        </header>

        {/* ── Priorities ─────────────────────────────────────────────── */}
        <section className="mt-8 break-inside-avoid-page">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 pb-2 border-b border-slate-200">
            Now — what the company is pushing on
          </h2>
          {nowObjectives.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No objectives in Now.</p>
          ) : (
            <ol className="mt-1 divide-y divide-slate-100">
              {nowObjectives.map((o, idx) => (
                <li key={o.id} className="flex items-start gap-4 py-3 break-inside-avoid">
                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center size-6 rounded-full bg-slate-900 text-white text-xs font-semibold tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium leading-snug">
                      {o.title}
                      {objectiveHealth(o.health) !== 'on_track' && (
                        <span className="ml-2 inline-flex items-center rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 align-middle">
                          {OBJECTIVE_HEALTH_LABELS[objectiveHealth(o.health)]}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 tabular-nums">
                      {o.owner && <>Owner: {o.owner.name} · </>}
                      {o.open} open task{o.open === 1 ? '' : 's'}
                      {o.overdue > 0 && <> · {o.overdue} overdue</>}
                      {o.target_date && <> · Target {formatDate(o.target_date)}</>}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {soonObjectives.length > 0 && (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium text-slate-900">{OBJECTIVE_BUCKET_LABELS.soon}:</span>{' '}
              {soonObjectives.map((o) => o.title).join(' · ')}
            </p>
          )}
        </section>

        {/* ── Handoffs ───────────────────────────────────────────────── */}
        <section className="mt-8 break-inside-avoid-page">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 pb-2 border-b border-slate-200">
            Handoffs — what people owe each other
            <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">
              {handoffs.length} open
            </span>
          </h2>
          {handoffs.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Nothing is blocked on anyone.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {handoffs.map((t) => {
                  const age = ageInDays(t.waiting_on_since)
                  const stale = age !== null && age >= 7
                  return (
                    <tr key={t.id} className="break-inside-avoid">
                      <td className="py-2 pr-3 whitespace-nowrap font-medium">
                        {t.blocker?.name ?? 'Someone'}
                        <span className="text-slate-400"> → </span>
                        {t.assignee?.name ?? 'Unassigned'}
                      </td>
                      <td className="py-2 pr-3">
                        {t.waiting_on_what}
                        <span className="block text-xs text-slate-500">{taskLine(t)}</span>
                      </td>
                      <td
                        className={`py-2 text-right whitespace-nowrap tabular-nums ${
                          stale ? 'font-semibold text-slate-900' : 'text-slate-500'
                        }`}
                      >
                        {age === 0 ? 'today' : `${age}d`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Each person's week ─────────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 pb-2 border-b border-slate-200">
            {focus ? 'Your week' : "Each person's week"}
          </h2>
          {people.map(({ member, overdue, dueThisWeek, noDate, owes, blockedOn }) => {
            const nothing =
              overdue.length + dueThisWeek.length + noDate.length + owes.length === 0
            return (
              <div key={member.id} className="mt-5 break-inside-avoid-page">
                <h3 className="text-sm font-semibold border-b border-slate-100 pb-1">
                  {member.name}
                  <span className="ml-2 font-normal text-xs text-slate-500 tabular-nums">
                    {overdue.length + dueThisWeek.length + noDate.length} open
                    {owes.length > 0 && <> · holding up {owes.length}</>}
                  </span>
                </h3>

                {nothing ? (
                  <p className="mt-2 text-sm text-slate-400">Nothing open.</p>
                ) : (
                  <div className="mt-2 space-y-3">
                    {overdue.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Overdue</p>
                        <ul className="mt-1 space-y-1">
                          {overdue.map((t) => (
                            <li key={t.id} className="text-sm flex gap-2">
                              <span className="shrink-0 tabular-nums text-slate-500 w-16">
                                {formatDate(t.due_date)}
                              </span>
                              <span>{taskLine(t)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {dueThisWeek.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Due this week</p>
                        <ul className="mt-1 space-y-1">
                          {dueThisWeek.map((t) => (
                            <li key={t.id} className="text-sm flex gap-2">
                              <span className="shrink-0 tabular-nums text-slate-500 w-16">
                                {formatDate(t.due_date)}
                              </span>
                              <span>{taskLine(t)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {owes.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Owes others
                        </p>
                        <ul className="mt-1 space-y-1">
                          {owes.map((t) => (
                            <li key={t.id} className="text-sm">
                              {t.waiting_on_what}
                              <span className="text-slate-500">
                                {' '}
                                — for {t.assignee?.name ?? 'the team'}
                                {(() => {
                                  const age = ageInDays(t.waiting_on_since)
                                  return age ? ` · ${age}d` : ''
                                })()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {blockedOn.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Waiting on others
                        </p>
                        <ul className="mt-1 space-y-1">
                          {blockedOn.map((t) => (
                            <li key={t.id} className="text-sm text-slate-600">
                              {t.blocker?.name ?? 'Someone'} — {t.waiting_on_what}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {noDate.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">No due date</p>
                        <ul className="mt-1 space-y-1">
                          {noDate.map((t) => (
                            <li key={t.id} className="text-sm">
                              {taskLine(t)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {/* ── Dates that move ────────────────────────────────────────── */}
        {(milestones.length > 0 || bids.length > 0) && (
          <section className="mt-8 break-inside-avoid-page">
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 pb-2 border-b border-slate-200">
              Dates that move — next two weeks
            </h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {bids.map((p) => (
                <li key={p.id} className="py-2 text-sm flex gap-3 break-inside-avoid">
                  <span className="shrink-0 tabular-nums text-slate-500 w-24">
                    {formatDate(p.bid_due_date)}
                  </span>
                  <span>
                    <span className="font-medium">Bid due</span> · {p.name}
                  </span>
                </li>
              ))}
              {milestones.map((m) => (
                <li key={m.id} className="py-2 text-sm flex gap-3 break-inside-avoid">
                  <span className="shrink-0 tabular-nums text-slate-500 w-24">
                    {formatDate(m.target_date)}
                  </span>
                  <span>
                    {m.title}
                    {m.project && <span className="text-slate-500"> · {m.project.name}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Closed last week ───────────────────────────────────────── */}
        <section className="mt-8 break-inside-avoid-page">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 pb-2 border-b border-slate-200">
            Closed last week
            <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">
              {closedLastWeek.length}
            </span>
          </h2>
          {closedLastWeek.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Nothing was closed out.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {closedLastWeek.map((t) => (
                <li key={t.id} className="text-sm flex gap-2 break-inside-avoid">
                  <span className="shrink-0 text-slate-500 w-24 truncate">
                    {t.assignee?.name ?? 'Unassigned'}
                  </span>
                  <span>{taskLine(t)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-12 pt-4 border-t border-slate-200 text-xs text-slate-400">
          Ber Wilson — internal working document
        </footer>
      </div>
    </div>
  )
}
