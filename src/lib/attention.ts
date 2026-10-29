/**
 * Attention engine — everything that's falling through the cracks:
 * - Overdue tasks (from the tasks table)
 * - Stale waiting-on items (older than 14 days with no follow-up)
 * - Approaching milestones with no recent activity
 * - Critical/blocker DD items with no resolution
 * - Compliance items expiring within 90 days
 * - Decisions with no follow-through
 * - Active cross-project dependency risks
 * - Investor follow-ups (overdue next steps; hot/committed-stage investors going cold)
 * - Dino payments coming due (installments we owe Dino Service Pros)
 * - Company certifications expiring within 90 days, or already lapsed
 *
 * Consumed by GET /api/attention and the agent's get_attention_items tool
 * (which calls computeAttention() directly — no HTTP self-fetch).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { dropHidden, hiddenProjectIds } from '@/lib/security/confidential'
import {
  activeDismissals,
  dismissedRowIds,
  excludeDismissed,
  type AttentionDismissal,
} from '@/lib/attention-dismissals'
import { fetchOpenTasks } from '@/lib/tasks/queries'
import {
  ATTENTION_KINDS,
  type AttentionCategory,
  type AttentionSummary,
} from '@/lib/attention-kinds'

export { ATTENTION_KINDS, attentionKind, attentionHref, urgencyBand } from '@/lib/attention-kinds'
export type { AttentionCategory, AttentionSummary } from '@/lib/attention-kinds'

export interface AttentionItem {
  id: string
  category: AttentionCategory
  urgency: number // 0-100, higher = more urgent
  title: string
  detail: string
  project_id: string | null
  project_name: string
  age_days: number
  due_date: string | null
  source_date: string
}


/**
 * The one "needs attention" count.
 *
 * ⚠ THREE DEFINITIONS OF THIS NUMBER WERE ON SCREEN AT ONCE. The sidebar's
 * Dashboard badge summed overdue milestones + critical diligence + overdue
 * tasks; the dashboard's KPI tile summed critical diligence + overdue
 * milestones + expiring certs + THE WHOLE DECIDE QUEUE; and the Needs
 * Attention rail summed nine sub-lists, several of them already sliced to six,
 * so its own header under-reported by construction. A reader saw 1, 197 and a
 * third number on one page and could not trust any of them.
 *
 * Four cheap head counts, deliberately NOT `computeAttention()`: that engine
 * runs a dozen queries and this runs in the root layout on every page. (It no
 * longer includes `lead_reviews` — those left the registry on 2026-10-21 — but
 * the cost argument is unchanged and is the reason this stays separate.)
 *
 * "Attention" is work falling through the cracks. The Decide queue is inbound
 * work awaiting a call, it is counted by `countDecideItems()`, and the two are
 * never summed.
 */
/**
 * The four things the badge counts, named once.
 *
 * `countAttention()` head-counts exactly these and `computeAttention()` scores
 * them among its ten categories. The list is here so the two cannot silently
 * come to disagree about WHICH quantities "needs attention" means — the failure
 * this whole module's docblock is about.
 *
 * `expiring_certification` reads `certifications`, which is a COMPANY record
 * with no project at all. `expiring_compliance` in `AttentionSummary` is a
 * different table (`compliance_items`) under a similar name; they are not
 * interchangeable and must never be summed together.
 */
export const COUNTED_ATTENTION_KINDS = [
  'overdue_milestone',
  'critical_dd',
  'overdue_task',
  'expiring_certification',
] as const

export type CountedAttentionKind = (typeof COUNTED_ATTENTION_KINDS)[number]

/**
 * Exclude confidential projects from a head count, in SQL.
 *
 * ⚠ THE WHOLE REASON THIS EXISTS. `computeAttention()` filters with
 * `dropHidden()` AFTER it has the rows, which a head count cannot do — it never
 * receives any. So until 2026-10-17 the sidebar badge, which renders in the
 * root layout on EVERY page for EVERY viewer, counted a confidential project's
 * overdue milestones, overdue tasks and critical diligence items. §8 is
 * explicit that containment keeps such a project out of "every aggregate", and
 * a count is an aggregate.
 *
 * ⚠ AND IT MUST KEEP NULL `project_id` ROWS. These are §4 shared children:
 * `milestones`, `dd_items` and `tasks` all hang off a project OR an
 * opportunity, so project_id is nullable. A bare `.not('project_id','in',…)`
 * is NULL for those rows and therefore not true, which would silently discard
 * every opportunity-attached row — §12's `.neq()`-is-NULL trap, wearing a
 * different operator. `dropHidden()` keeps them (`!id || !hidden.has(id)`), so
 * this keeps them too: the two readers must filter identically or the badge and
 * the list disagree again.
 */
export function hiddenProjectFilter(hidden: Set<string>): string | null {
  if (hidden.size === 0) return null
  // A uuid cannot contain a comma or a parenthesis, so this interpolation
  // cannot break out of the filter — but §12 says the quoting IS the defence,
  // so anything that is not a uuid is dropped rather than trusted.
  const ids = [...hidden].filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
  if (ids.length === 0) return null
  return `project_id.is.null,project_id.not.in.(${ids.join(',')})`
}

function excludeHidden<T extends { or: (f: string) => T }>(query: T, hidden: Set<string>): T {
  const filter = hiddenProjectFilter(hidden)
  return filter === null ? query : query.or(filter)
}

export async function countAttention(): Promise<number> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const in90Days = new Date(Date.now() + 90 * 86_400_000).toISOString().split('T')[0]

  /*
    ⚠ DISMISSALS HAVE TO BE APPLIED HERE TOO, IN SQL, AND THIS IS THE READER
    THAT CANNOT DO IT ANY OTHER WAY. These are `head: true` counts: they never
    receive a row, so there is nothing for a JavaScript filter to run against
    (§12 — a count is an aggregate and a row-filter has no equivalent on one,
    the same shape as the bug that let a confidential project reach this badge).
    Dismissing an overdue task on /attention and watching the sidebar keep
    counting it is how three contradictory "needs attention" numbers happen, and
    this module's own docblock is about nothing else.

    `certifications` is not filtered because nothing can dismiss one: it is a
    company record with no attention kind pointing at it, which is the same
    reason it has no project filter either. See COUNTED_ATTENTION_KINDS.
  */
  const dismissed = dismissedRowIds(await activeDismissals())

  // No viewer: containment, not access. A step-up opens a project's own pages,
  // never a portfolio-wide aggregate, so this count is the same for both
  // admins. Fails CLOSED — a transient error returns every project id, which
  // reads the badge low rather than leaking a name.
  const hidden = await hiddenProjectIds(null)

  const [{ count: overdueMilestones }, { count: criticalDd }, { count: overdueTasks }, { count: expiringCerts }] =
    await Promise.all([
      excludeDismissed(
        excludeHidden(
          supabase
            .from('milestones')
            .select('id', { count: 'exact', head: true })
            .is('completed_at', null)
            .lt('target_date', today),
          hidden
        ),
        dismissed,
        'milestones'
      ),
      excludeDismissed(
        excludeHidden(
          supabase
            .from('dd_items')
            .select('id', { count: 'exact', head: true })
            .neq('status', 'resolved')
            .in('severity', ['critical', 'blocker']),
          hidden
        ),
        dismissed,
        'dd_items'
      ),
      excludeDismissed(
        excludeHidden(
          supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'open')
            .lt('due_date', today),
          hidden
        ),
        dismissed,
        'tasks'
      ),
      // NOT filtered, and not an oversight: `certifications` is a company-level
      // record with no project_id to filter on. See COUNTED_ATTENTION_KINDS.
      supabase
        .from('certifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .lte('expiration_date', in90Days),
    ])

  return (overdueMilestones ?? 0) + (criticalDd ?? 0) + (overdueTasks ?? 0) + (expiringCerts ?? 0)
}

export async function computeAttention(): Promise<{
  items: AttentionItem[]
  summary: AttentionSummary
  /**
   * The items a human has pushed out of sight, still in force.
   *
   * Returned so the one surface with a reader can offer the undo — a dismissal
   * nobody can see or restore is indistinguishable from a delete, and §12 is
   * blunt that an automatic pass and the undo for it have to be a pair. The
   * four other callers (the rail, the agent tool, Pepper's note, the API)
   * simply ignore it.
   */
  dismissed: AttentionDismissal[]
}> {
  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const in90DaysFromNow = new Date(now.getTime() + 90 * 86_400_000).toISOString().split('T')[0]
  const items: AttentionItem[] = []

  // Parallel data fetch — tasks come from the real task system (tasks table)
  const [
    overdueTasks,
    { data: projects },
    { data: updates },
    { data: milestones },
    { data: ddItems },
    { data: complianceItems },
    { data: dependencies },
    { data: investors },
    { data: dinoPayments },
    { data: expiringCertifications },
  ] = await Promise.all([
    fetchOpenTasks(supabase, { dueBefore: today }),
    supabase.from('projects').select('id, name').eq('status', 'active'),
    supabase
      .from('updates')
      .select('id, project_id, summary, waiting_on, decisions, created_at, projects(name)')
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('milestones')
      .select('id, label, stage, target_date, completed_at, project_id, projects(name)')
      .is('completed_at', null)
      .lte('target_date', new Date(now.getTime() + 30 * 86_400_000).toISOString().split('T')[0])
      .order('target_date'),
    supabase
      .from('dd_items')
      .select('id, category, item, severity, status, notes, project_id, created_at, projects(name)')
      .neq('status', 'resolved')
      .in('severity', ['critical', 'blocker']),
    supabase
      .from('compliance_items')
      .select('id, framework, requirement, status, due_date, project_id, projects(name)')
      .not('status', 'in', '("compliant","waived")')
      .lte('due_date', new Date(now.getTime() + 90 * 86_400_000).toISOString().split('T')[0])
      .order('due_date'),
    supabase
      .from('project_dependencies')
      .select('id, upstream_project_id, downstream_project_id, dependency_type, description, severity, status, created_at')
      .eq('status', 'active')
      .in('severity', ['critical', 'blocker']),
    // Capital raise — a failed select (table missing) just yields null → no items
    supabase
      .from('investors')
      .select('id, name, stage, interest_level, next_step, next_step_date, last_contact_date, created_at')
      .not('stage', 'in', '(passed,dormant)'),
    // Dino — unpaid installments due within 30 days or overdue (fails quietly
    // pre-migration → null → no items)
    supabase
      .from('dino_payments')
      .select('id, label, amount, due_date, paid')
      .eq('paid', false)
      .not('due_date', 'is', null)
      .lte('due_date', new Date(now.getTime() + 30 * 86_400_000).toISOString().split('T')[0])
      .order('due_date'),
    // Company certifications expiring inside 90 days, or already lapsed.
    //
    // ⚠ THE BADGE COUNTED THESE AND THIS ENGINE DID NOT PRODUCE THEM. Four
    // quantities feed `countAttention()` and only three had a kind here, so the
    // sidebar's number named rows no list could render — which is how the
    // dashboard came to run its OWN attention query set to show them.
    //
    // No project filter and no dismissal filter, deliberately: a certification
    // is a company record with no project_id to contain it by, exactly as
    // `countAttention()` says of the same table.
    supabase
      .from('certifications')
      .select('id, name, expiration_date, issuing_body')
      .eq('is_active', true)
      .lte('expiration_date', in90DaysFromNow)
      .order('expiration_date'),
  ])

  const projectName = (u: { projects: unknown }) =>
    (u.projects as { name: string } | null)?.name ?? 'Unknown'

  const projectMap: Record<string, string> = {}
  for (const p of projects ?? []) projectMap[p.id] = p.name

  type JsonWaitingOn = { text?: string; party?: string; since?: string }
  type JsonDecision = { text?: string; made_by?: string; date?: string }

  // 1. Overdue tasks (from the tasks table — the real task system)
  for (const t of overdueTasks) {
    if (!t.due_date || t.due_date >= today) continue // due today isn't overdue
    const ageDays = Math.floor((now.getTime() - new Date(t.due_date).getTime()) / 86_400_000)
    items.push({
      id: `task-${t.id}`,
      category: 'overdue_action',
      urgency: Math.min(100, 60 + ageDays * 2),
      title: t.title,
      detail: t.assignee ? `Assigned to ${t.assignee} · ${ageDays}d overdue` : `${ageDays}d overdue`,
      project_id: t.project_id,
      project_name: t.project_name ?? '—',
      age_days: ageDays,
      due_date: t.due_date,
      source_date: t.created_at ?? '',
    })
  }

  // 2. Stale waiting-on items (> 14 days since mentioned)
  for (const u of updates ?? []) {
    const waitingOn = (u.waiting_on ?? []) as JsonWaitingOn[]
    for (const item of waitingOn) {
      const sinceDate = item.since ? new Date(item.since) : new Date(u.created_at ?? '')
      const ageDays = Math.floor((now.getTime() - sinceDate.getTime()) / 86_400_000)
      if (ageDays < 14) continue

      items.push({
        id: `waiting-${u.id}-${item.text?.slice(0, 20)}`,
        category: 'stale_waiting',
        urgency: Math.min(100, 40 + ageDays),
        title: item.text ?? 'Waiting on unknown',
        detail: item.party ? `Waiting on ${item.party} · ${ageDays}d` : `${ageDays}d since flagged`,
        project_id: u.project_id,
        project_name: projectName(u),
        age_days: ageDays,
        due_date: null,
        source_date: item.since ?? u.created_at ?? '',
      })
    }
  }

  // 3. Approaching milestones (within 30 days or overdue)
  for (const m of milestones ?? []) {
    if (!m.target_date) continue
    const targetDate = new Date(m.target_date)
    const daysUntil = Math.floor((targetDate.getTime() - now.getTime()) / 86_400_000)
    const isOverdue = targetDate < now

    // Check if there's a recent update for this project
    const recentUpdate = (updates ?? []).find(
      u => u.project_id === m.project_id &&
        (now.getTime() - new Date(u.created_at ?? '').getTime()) < 14 * 86_400_000
    )

    // Only flag if overdue OR approaching with no recent activity
    if (!isOverdue && recentUpdate) continue

    items.push({
      id: `milestone-${m.id}`,
      category: 'approaching_milestone',
      urgency: isOverdue ? Math.min(100, 70 + Math.abs(daysUntil) * 2) : Math.max(30, 60 - daysUntil),
      title: m.label,
      detail: isOverdue
        ? `${Math.abs(daysUntil)}d overdue · ${m.stage} gate`
        : `${daysUntil}d away · ${m.stage} gate${!recentUpdate ? ' · No recent updates' : ''}`,
      project_id: m.project_id,
      project_name: projectName(m),
      age_days: isOverdue ? Math.abs(daysUntil) : 0,
      due_date: m.target_date,
      source_date: m.target_date,
    })
  }

  // 4. Critical/blocker DD items
  for (const dd of ddItems ?? []) {
    const ageDays = Math.floor((now.getTime() - new Date(dd.created_at ?? '').getTime()) / 86_400_000)
    items.push({
      id: `dd-${dd.id}`,
      category: 'critical_dd',
      urgency: dd.severity === 'blocker' ? 95 : 75,
      title: dd.item,
      detail: `${(dd.severity ?? 'info').toUpperCase()} · ${dd.category} · ${ageDays}d open`,
      project_id: dd.project_id,
      project_name: projectName(dd),
      age_days: ageDays,
      due_date: null,
      source_date: dd.created_at ?? '',
    })
  }

  // 5. Expiring compliance items
  for (const c of complianceItems ?? []) {
    if (!c.due_date) continue
    const dueDate = new Date(c.due_date)
    const daysUntil = Math.floor((dueDate.getTime() - now.getTime()) / 86_400_000)
    const isOverdue = c.due_date < today

    items.push({
      id: `comp-${c.id}`,
      category: 'expiring_compliance',
      urgency: isOverdue ? 85 : Math.max(20, 70 - daysUntil),
      title: `${c.framework}: ${c.requirement}`,
      detail: isOverdue
        ? `OVERDUE · ${c.status}`
        : `${daysUntil}d until due · ${c.status}`,
      project_id: c.project_id,
      project_name: projectName(c),
      age_days: isOverdue ? Math.abs(daysUntil) : 0,
      due_date: c.due_date,
      source_date: c.due_date,
    })
  }

  // 6. Stale decisions — decisions older than 14 days with no more recent update mentioning follow-through
  const seenDecisions = new Set<string>()
  for (const u of updates ?? []) {
    const decisions = (u.decisions ?? []) as JsonDecision[]
    for (const d of decisions) {
      if (!d.text) continue
      const key = `${u.project_id}-${d.text.slice(0, 50)}`
      if (seenDecisions.has(key)) continue
      seenDecisions.add(key)

      const decisionDate = d.date ? new Date(d.date) : new Date(u.created_at ?? '')
      const ageDays = Math.floor((now.getTime() - decisionDate.getTime()) / 86_400_000)
      if (ageDays < 14) continue

      // Check if any more recent update in same project mentions related keywords
      const decisionWords = d.text.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 3)
      const hasFollowUp = (updates ?? []).some(later => {
        if (later.project_id !== u.project_id) return false
        if (new Date(later.created_at ?? '') <= new Date(u.created_at ?? '')) return false
        const summary = later.summary ?? ''
        return decisionWords.some(w => summary.toLowerCase().includes(w))
      })

      if (hasFollowUp) continue

      items.push({
        id: `decision-${u.id}-${d.text.slice(0, 20)}`,
        category: 'stale_decision',
        urgency: Math.min(90, 35 + ageDays),
        title: d.text,
        detail: `Decision by ${d.made_by ?? 'unknown'} · ${ageDays}d ago · No follow-up detected`,
        project_id: u.project_id,
        project_name: projectName(u),
        age_days: ageDays,
        due_date: null,
        source_date: d.date ?? u.created_at ?? '',
      })
    }
  }

  // 7. Cross-project dependency risks
  for (const dep of dependencies ?? []) {
    const ageDays = Math.floor((now.getTime() - new Date(dep.created_at).getTime()) / 86_400_000)
    const upName = projectMap[dep.upstream_project_id] ?? 'Unknown'
    const downName = projectMap[dep.downstream_project_id] ?? 'Unknown'

    items.push({
      id: `dep-${dep.id}`,
      category: 'dependency_risk',
      urgency: dep.severity === 'blocker' ? 90 : 70,
      title: dep.description ?? `${upName} blocks ${downName}`,
      detail: `${dep.severity.toUpperCase()} · ${upName} → ${downName} · ${ageDays}d active`,
      project_id: dep.downstream_project_id,
      project_name: downName,
      age_days: ageDays,
      due_date: null,
      source_date: dep.created_at,
    })
  }

  // 8. Investor follow-ups — overdue next steps, and hot/late-stage investors going cold
  for (const inv of investors ?? []) {
    if (inv.next_step_date && inv.next_step_date < today) {
      const ageDays = Math.floor((now.getTime() - new Date(inv.next_step_date).getTime()) / 86_400_000)
      items.push({
        id: `investor-next-${inv.id}`,
        category: 'investor_followup',
        urgency: Math.min(100, 55 + ageDays * 2),
        title: inv.next_step ? `${inv.name}: ${inv.next_step}` : `${inv.name} — next step overdue`,
        detail: `Investor next step ${ageDays}d overdue · ${inv.stage}${inv.interest_level ? ` · ${inv.interest_level}` : ''}`,
        project_id: null,
        project_name: 'Capital Raise',
        age_days: ageDays,
        due_date: inv.next_step_date,
        source_date: inv.next_step_date,
      })
      continue // one item per investor is enough
    }

    // Hot or late-stage (soft-committed/committed) investors with no contact in 21+ days
    const lateStage = inv.stage === 'soft_committed' || inv.stage === 'committed'
    if (inv.interest_level === 'hot' || lateStage) {
      const lastTouch = inv.last_contact_date ?? inv.created_at?.slice(0, 10)
      if (!lastTouch) continue
      const ageDays = Math.floor((now.getTime() - new Date(lastTouch).getTime()) / 86_400_000)
      if (ageDays < 21) continue
      items.push({
        id: `investor-cold-${inv.id}`,
        category: 'investor_followup',
        urgency: Math.min(90, 40 + ageDays),
        title: `${inv.name} is going cold`,
        detail: `${inv.interest_level === 'hot' ? 'Hot investor' : `Investor at ${inv.stage}`} · no contact in ${ageDays}d`,
        project_id: null,
        project_name: 'Capital Raise',
        age_days: ageDays,
        due_date: null,
        source_date: lastTouch,
      })
    }
  }

  // 9. Dino payments — installments we owe Dino coming due / overdue
  for (const p of dinoPayments ?? []) {
    if (!p.due_date) continue
    const daysUntil = Math.floor((new Date(p.due_date).getTime() - now.getTime()) / 86_400_000)
    const isOverdue = p.due_date < today
    const amountLabel = p.amount != null ? `$${Math.round(p.amount).toLocaleString()}` : ''
    items.push({
      id: `dino-payment-${p.id}`,
      category: 'dino_payment',
      urgency: isOverdue ? Math.min(100, 70 + Math.abs(daysUntil) * 2) : Math.max(40, 65 - daysUntil),
      title: `${p.label ?? 'Dino installment'}${amountLabel ? ` — ${amountLabel}` : ''}`,
      detail: isOverdue ? `Payment to Dino ${Math.abs(daysUntil)}d overdue` : `Payment to Dino due in ${daysUntil}d`,
      project_id: null,
      project_name: 'Dino Service Pros',
      age_days: isOverdue ? Math.abs(daysUntil) : 0,
      due_date: p.due_date,
      source_date: p.due_date,
    })
  }

  // 10. Company certifications expiring or lapsed
  //
  // Urgency is written so a LAPSED cert outranks every other kind on the board:
  // a bid submitted against an expired certification is not a slipped date, it
  // is a disqualification. An upcoming one rises as the date closes.
  for (const c of expiringCertifications ?? []) {
    if (!c.expiration_date) continue
    const daysUntil = Math.floor(
      (new Date(c.expiration_date).getTime() - now.getTime()) / 86_400_000
    )
    const lapsed = c.expiration_date < today
    items.push({
      id: `cert-${c.id}`,
      category: 'expiring_certification',
      urgency: lapsed ? 100 : Math.max(45, 95 - daysUntil),
      title: lapsed ? `${c.name} has expired` : `${c.name} expires in ${daysUntil}d`,
      detail: c.issuing_body
        ? `${c.issuing_body} · ${lapsed ? 'renew before the next submission' : 'renewal window open'}`
        : lapsed
          ? 'Renew before the next submission'
          : 'Renewal window open',
      // A company record. Never withheld, because it belongs to no project that
      // could be protected — see the containment note below.
      project_id: null,
      project_name: 'Ber Wilson',
      age_days: lapsed ? Math.abs(daysUntil) : 0,
      due_date: c.expiration_date,
      source_date: c.expiration_date,
    })
  }

  // ⚠ INBOUND LEADS USED TO BE ITEM 10 HERE AND WERE REMOVED ON 2026-10-21.
  // /decide owns them: it ranks every lead by its bid deadline, prints the
  // date on the row and carries Accept and Delete. Listing them here as well
  // put one quantity on two screens under two different filters — see the note
  // at the foot of ATTENTION_KINDS for why the "only the imminent ones" middle
  // option is worse rather than better. `openLeads` and the `leadsDb()` fetch
  // went with it, so this function no longer reads the leads table at all.

  // ── Protected projects, removed once at the end ─────────────────────────────
  //
  // Here rather than in each of the fetches above, because every item
  // already carries project_id and every one of this function's three callers
  // wants the same answer: the /attention API, Ber AI's get_attention_items, and
  // Pepper's morning EMAIL. The email is why there is no option to opt out — a
  // note that has been sent cannot be locked afterwards.
  //
  // An item with no project (a Dino payment, a certification, an investor) is
  // never withheld; it belongs to nothing that can be protected.
  const hidden = await hiddenProjectIds(null)
  const withheld = dropHidden(items, (i) => i.project_id, hidden)

  /*
    ── Dismissed items, removed in the same place and for the same reason ─────

    ⚠ HERE RATHER THAN IN EACH CALLER. §12: a filter belongs at the choke point
    as a DEFAULT, not as a parameter every caller passes — forgetting to opt in
    is how /attention, the dashboard rail, the sidebar badge, Ber AI's
    `get_attention_items` and Pepper's 06:50 note would come to disagree about
    one list, and the note is the one that cannot be taken back once sent.

    A dismissal is a QUIET, not a verdict: the row is untouched, the engine will
    rebuild the item from it the moment the quiet lapses, and deleting the mark
    puts it back immediately. Compare `commitments.snoozed_until`, which took
    the same shape for the same reason.
  */
  const dismissed = await activeDismissals()
  const suppressed = new Set(dismissed.map((d) => d.item_key))
  const visible = withheld.filter((i) => !suppressed.has(i.id))

  // Sort by urgency descending
  visible.sort((a, b) => b.urgency - a.urgency)

  // Summary counts, one per registry row. Was eleven hand-written lines.
  const counts = {} as Record<(typeof ATTENTION_KINDS)[number]['summaryKey'], number>
  for (const k of ATTENTION_KINDS) {
    counts[k.summaryKey] = visible.filter((i) => i.category === k.category).length
  }
  const summary: AttentionSummary = { total: visible.length, ...counts }

  /*
    ⚠ THE DISMISSED LIST IS A CROSS-PORTFOLIO SURFACE AND IS CONTAINED LIKE ONE.
    It holds a snapshot of each item's title, so a protected project's milestone
    would be readable there by anyone — §8 says a `confidential` project leaves
    EVERY cross-portfolio surface, and a list of things somebody silenced is one.
    Filtered with the same `dropHidden()` and the same `hidden` set as the items
    above, because §12's lesson is that a table gaining a second way to name its
    record breaks an existing security filter without touching it.
  */
  const visibleDismissed = dropHidden(dismissed, (d) => d.project_id, hidden)

  return { items: visible, summary, dismissed: visibleDismissed }
}
