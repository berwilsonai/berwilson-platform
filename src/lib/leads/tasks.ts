/**
 * Put lead bid deadlines where the work already lives: the task board.
 *
 * This replaces the calendar sync that used to stand here. That module wrote
 * an all-day event for every pursue/consider lead's bid date, site visit and
 * RFI cut-off — and nothing ever deleted them. By 2026-09-21, 107 leads had
 * events written and 100 of those bid dates were already in the past, so the
 * calendar had become the noisiest surface in the company while the task board
 * held six rows.
 *
 * A task is the better carrier for the same fact. It has an owner, it can be
 * completed, and `google-sync.ts` already pushes it to that owner's Google
 * Tasks — where a due date renders in Google Calendar discreetly, which is the
 * outcome the calendar events were reaching for and overshooting.
 *
 * BID DATES ONLY, one task per lead (Richard's call). The site visit and RFI
 * dates are not lost: they are written into the task body, which is where they
 * are actually readable on a phone.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { leadsDb, type LeadRow } from './db'

export interface LeadTaskProgress {
  considered: number
  created: number
  /** The bid date moved, so the due date moved with it. */
  updated: number
  /** The lead died (expired / ignored / passed) and its task was closed. */
  closed: number
  /** Created but with nobody to own them — see the assignee note below. */
  unassigned: number
  skipped: boolean
  reason?: string
  errors: string[]
}

/** Same bar the calendar used, and the digest still uses. */
const WORTH_TRACKING = new Set(['pursue', 'consider'])

/**
 * Lead states that mean the bid is no longer live. A task still sitting open
 * for one of these is precisely the clutter this change exists to remove — it
 * would simply have moved from the calendar to the task list.
 */
const DEAD_STATUSES = new Set(['expired', 'ignored', 'forwarded', 'spam'])

function emptyProgress(): LeadTaskProgress {
  return {
    considered: 0,
    created: 0,
    updated: 0,
    closed: 0,
    unassigned: 0,
    skipped: false,
    errors: [],
  }
}

/** `2026-09-22` for the local day, without going through a Date constructor. */
function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function money(value: number | null): string | null {
  if (value === null) return null
  return `est. $${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/**
 * The task body.
 *
 * TWO RULES, both learned the hard way elsewhere in this repo.
 *
 * 1. The site-visit and RFI dates go in `what`, NOT `how`. buildTaskBody in
 *    tasks/google-body.ts composes the Google Tasks notes from `what` and
 *    `why` only — `how` never leaves the platform. Putting a mandatory site
 *    visit in `how` would make it invisible on the phone, recreating the exact
 *    failure the calendar module was written to fix.
 *
 * 2. Nothing here may be derived from the clock. No "3 days left", no "as of".
 *    google-body.ts states the invariant: the pushed body must be a pure
 *    function of stable columns, or every task differs on every reconcile,
 *    bumps Google's `updated` across the whole board, and burns quota linearly
 *    with its size.
 */
function describeLead(lead: LeadRow): string {
  const dates = [
    lead.site_visit_date
      ? `Site visit: ${lead.site_visit_date} — attendance is often mandatory to remain eligible to bid.`
      : null,
    lead.rfi_due_date ? `RFI deadline: ${lead.rfi_due_date}` : null,
    lead.solicitation_number ? `Solicitation: ${lead.solicitation_number}` : null,
  ].filter((l): l is string => l !== null)

  const who = [lead.sender_company, lead.location, money(lead.estimated_value)]
    .filter((l): l is string => Boolean(l))
    .join(' · ')

  const lines = [
    ...dates,
    dates.length > 0 ? '' : null,
    who ? `From: ${who}` : null,
    lead.summary ? (who ? '' : null) : null,
    lead.summary ? lead.summary.slice(0, 600) : null,
    process.env.APP_URL ? '' : null,
    // buildNotes appends the TASK link, never the lead's — without this the
    // phone has no route back to the thing the task is about.
    process.env.APP_URL ? `Lead: ${process.env.APP_URL}/leads?lead=${lead.id}` : null,
  ].filter((l): l is string => l !== null)

  return lines.join('\n')
}

/** The one-line justification the board renders as a card subtitle. */
function whyLine(lead: LeadRow): string {
  const verdict = lead.fit_recommendation ? lead.fit_recommendation.toUpperCase() : 'UNSCORED'
  const score = lead.fit_score !== null ? ` (${lead.fit_score}/100)` : ''
  const concerns = Array.isArray(lead.fit_concerns) ? lead.fit_concerns : []
  const first = concerns.length > 0 ? ` ${String(concerns[0])}` : ''
  return `Ber AI: ${verdict}${score}.${first}`.slice(0, 500)
}

/**
 * Who owns a bid deadline.
 *
 * WHY AN UNRESOLVED OWNER STOPS THE WHOLE PHASE: pushTaskNow returns early
 * when assignee_id is null (tasks/google-push.ts) and syncMember is
 * per-member, so an UNASSIGNED TASK NEVER REACHES GOOGLE TASKS AT ALL.
 * Creating a pile of them would rebuild the invisible-work failure this change
 * exists to end — the deadlines would move off a cluttered calendar Richard
 * can see and into a list nobody's phone shows. Zero tasks plus a loud reason
 * is strictly better.
 *
 * Read at runtime, so changing the owner is an edit to .env.local plus a
 * restart — no rebuild, no deploy.
 */
async function resolveOwner(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ id: string; name: string } | { error: string }> {
  const wanted = (process.env.LEAD_TASK_OWNER ?? '').trim().toLowerCase()
  if (!wanted) {
    return { error: 'LEAD_TASK_OWNER is unset — no one would own these tasks, and an unassigned task never reaches Google Tasks.' }
  }

  const { data, error } = await supabase
    .from('team_members')
    .select('id, name, email')
    .eq('active', true)
  if (error) return { error: error.message }

  const match = (data ?? []).find(
    (m) => (m.email ?? '').toLowerCase() === wanted || m.name.toLowerCase() === wanted
  )
  if (!match) {
    return { error: `LEAD_TASK_OWNER="${process.env.LEAD_TASK_OWNER}" matches no active team member.` }
  }
  return { id: match.id, name: match.name }
}

/**
 * Write a task for every live bid deadline; close the ones that died.
 *
 * Never throws — the leads are safe in the queue whatever the board does.
 */
export async function syncLeadTasks(): Promise<LeadTaskProgress> {
  const progress = emptyProgress()

  if (process.env.LEAD_TASK_SYNC === 'off') {
    return { ...progress, skipped: true, reason: 'LEAD_TASK_SYNC=off' }
  }

  try {
    const supabase = createAdminClient()
    const owner = await resolveOwner(supabase)
    if ('error' in owner) return { ...progress, skipped: true, reason: owner.error }

    const today = todayISO()

    // Everything this phase might touch, in one read: the live candidates and
    // the leads that already hold a task.
    const { data, error } = await leadsDb()
      .from('leads')
      .select('*')
      .or('task_synced_at.not.is.null,and(status.in.(new,reviewing),score_state.eq.scored)')
    if (error) return { ...progress, skipped: true, reason: error.message }

    const leads = (data ?? []) as LeadRow[]
    const withTask = leads.filter((l) => l.task_id !== null)

    // One read for every existing lead task, rather than one per lead.
    const taskById = new Map<string, { id: string; status: string; due_date: string | null }>()
    if (withTask.length > 0) {
      const { data: rows } = await supabase
        .from('tasks')
        .select('id, status, due_date')
        .in('id', withTask.map((l) => l.task_id as string))
      for (const r of rows ?? []) taskById.set(r.id, r)
    }

    for (const lead of leads) {
      const live =
        WORTH_TRACKING.has(String(lead.fit_recommendation)) &&
        !DEAD_STATUSES.has(String(lead.status)) &&
        lead.bid_due_date !== null &&
        lead.bid_due_date >= today

      const existing = lead.task_id ? taskById.get(lead.task_id) : undefined

      // --- the bid is dead, and a task is still open for it ------------------
      if (!live && existing && existing.status === 'open') {
        // Marked done, never deleted: reversible from the board, recorded by
        // the log_tasks trigger, and it ticks off on the phone rather than
        // vanishing without explanation.
        const { error: closeErr } = await supabase
          .from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (closeErr) {
          if (progress.errors.length < 5) progress.errors.push(closeErr.message)
        } else {
          progress.closed++
        }
        continue
      }

      if (!live) continue
      progress.considered++

      // --- already has a task ------------------------------------------------
      if (existing) {
        // Never reopen a task someone completed.
        if (existing.status !== 'open') continue
        // The bid date moved. Push it — but only the date, because everything
        // else belongs to whoever has been editing the task since.
        if (lead.bid_due_date !== lead.task_bid_date) {
          const { error: upErr } = await supabase
            .from('tasks')
            .update({ due_date: lead.bid_due_date })
            .eq('id', existing.id)
          if (upErr) {
            if (progress.errors.length < 5) progress.errors.push(upErr.message)
            continue
          }
          await leadsDb().from('leads').update({ task_bid_date: lead.bid_due_date }).eq('id', lead.id)
          progress.updated++
        }
        continue
      }

      // --- the human deleted it ---------------------------------------------
      // The latch outlives the row on purpose. Deleting the task WAS the
      // decision; resurrecting it every morning is the behaviour that made the
      // calendar unbearable.
      if (lead.task_synced_at !== null) continue

      // --- create ------------------------------------------------------------
      const { data: created, error: insErr } = await supabase
        .from('tasks')
        .insert({
          title: `Bid due — ${lead.title}`.slice(0, 200),
          due_date: lead.bid_due_date,
          assignee_id: owner.id,
          status: 'open',
          lead_id: lead.id,
          what: describeLead(lead),
          why: whyLine(lead),
          how: 'Decide pursue / forward / ignore on the lead, then promote it to a project if pursuing.',
        })
        .select('id')
        .single()

      if (insErr || !created) {
        if (progress.errors.length < 5) progress.errors.push(insErr?.message ?? 'insert returned no row')
        continue
      }

      // Stamp the latch even if this next write fails — a task that exists
      // without a latch would be duplicated tomorrow.
      const { error: latchErr } = await leadsDb()
        .from('leads')
        .update({
          task_id: created.id,
          task_synced_at: new Date().toISOString(),
          task_bid_date: lead.bid_due_date,
        })
        .eq('id', lead.id)
      if (latchErr && progress.errors.length < 5) progress.errors.push(latchErr.message)

      progress.created++
    }
  } catch (err) {
    progress.errors.push(err instanceof Error ? err.message : String(err))
  }

  return progress
}

/**
 * Close a lead's task the moment a human decides, rather than at tomorrow's
 * sweep.
 *
 * A lead dismissed on /decide would otherwise leave a "Bid due" task sitting on
 * someone's phone until the next morning, which teaches them the sync is
 * unreliable — the complaint google-push.ts was written to answer. This is the
 * single-task case queueTaskPush's debounce was built for, unlike the sweep,
 * where firing it per row would mean one full per-member reconcile each.
 *
 * Fire-and-forget and never throws: the decision is already recorded, and a
 * task-board hiccup must not fail the request that made it.
 */
export function refreshLeadTask(lead: LeadRow): void {
  void (async () => {
    if (process.env.LEAD_TASK_SYNC === 'off') return
    if (!lead.task_id) return
    if (!DEAD_STATUSES.has(String(lead.status))) return

    const supabase = createAdminClient()
    const { data } = await supabase
      .from('tasks')
      .select('id, status')
      .eq('id', lead.task_id)
      .maybeSingle()
    if (!data || data.status !== 'open') return

    await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', data.id)

    const { queueTaskPush } = await import('@/lib/tasks/google-push')
    queueTaskPush(data.id)
  })().catch((err) => {
    console.warn('[leads/tasks] task refresh failed:', err instanceof Error ? err.message : err)
  })
}
