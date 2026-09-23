/**
 * Lead sweep orchestration — fetch, triage, score, expire, under one budget.
 *
 * Deliberately separate from the deal sweep's runSweep() rather than another
 * phase inside it. Two reasons: the two pipelines must not compete for the same
 * clock (the deal backfill would starve lead triage indefinitely), and a fault
 * in one must not stall the other. They share the fetch machinery and nothing
 * else.
 *
 * Ordering mirrors the deal sweep's hard-won lesson: fetch is network-bound and
 * finishes fast, so it goes first and fills the queue; scoring drains the leads
 * triage already produced and runs before triage so a long triage pass cannot
 * leave yesterday's leads unscored forever.
 */

import { fetchAllMailboxes, type FetchProgress } from '@/lib/email-sweep/fetch-phase'
import { triagePendingLeads, type TriageProgress } from './triage-phase'
import { scorePendingLeads, drainLeadQueue, type ScoreProgress, type DrainProgress } from './score-phase'
import { routeThreads, type RouteProgress } from '@/lib/email-sweep/route-phase'
import { applyThreadUpdates, type ApplyProgress } from '@/lib/email-sweep/apply-phase'
import { notifyScoredLeads, type LeadNotifyProgress } from './notify-leads'
import { syncLeadTasks, type LeadTaskProgress } from './tasks'
import { syncLeadLabels, type LeadLabelProgress } from './gmail-sync'
import { draftLeadReplies, type LeadDraftProgress } from './draft-reply'
import { publishLeadSheetsQuietly, type PublishSheetsResult } from './sheet'
import { runMailboxHygiene, type HygieneProgress } from './mailbox-hygiene'

export type LeadPhase =
  | 'fetch'
  | 'triage'
  | 'score'
  | 'route'
  | 'apply'
  | 'expire'
  | 'notify'
  | 'tasks'
  | 'label'
  | 'draft'
  | 'sheets'
  | 'hygiene'

export interface LeadSweepOptions {
  phases?: LeadPhase[]
  budgetMs?: number
  /**
   * How much history a FIRST sweep reads. Bid invitations go stale fast — a
   * two-year-old ITB is not a lead — so this defaults to one quarter rather
   * than the deal sweep's all-history default.
   */
  sinceDays?: number | null
  restart?: boolean
  userId?: string
}

export interface LeadSweepResult {
  ranPhases: LeadPhase[]
  route?: RouteProgress
  apply?: ApplyProgress
  fetch?: FetchProgress[]
  triage?: TriageProgress
  score?: ScoreProgress
  expired?: DrainProgress
  notified?: LeadNotifyProgress
  tasks?: LeadTaskProgress
  labels?: LeadLabelProgress
  drafts?: LeadDraftProgress
  sheets?: PublishSheetsResult | null
  hygiene?: HygieneProgress
  elapsedMs: number
  moreWork: boolean
}

const ALL_PHASES: LeadPhase[] = [
  'fetch',
  'triage',
  'score',
  'route',
  'apply',
  'expire',
  'label',
  'draft',
  'tasks',
  'notify',
  'sheets',
  'hygiene',
]

export const DEFAULT_LEAD_HISTORY_DAYS = 90

/**
 * How far back the routine hygiene pass looks.
 *
 * Wider than a day on purpose: a sender only becomes junk once it has sent
 * JUNK_MIN_THREADS messages, and a one-day window would never see three of them
 * together. Wide enough to spot a pattern, narrow enough to stay cheap.
 */
const HYGIENE_WINDOW_DAYS = 30

/** Deterministic phases, sized to drain a backlog over a few daily runs. */
const ROUTE_BATCH = 500
const APPLY_BATCH = 100

/** Ceiling on applying, so attachment imports cannot eat the whole run. */
const APPLY_MAX_MS = 10 * 60 * 1000

/** Share of the remaining budget the first scoring pass may take. */
const SCORE_SHARE = 0.4

/**
 * Share of the budget held back from triage for a SECOND scoring pass.
 *
 * Without it, triage consumes everything left and a lead read this morning is
 * not scored — and so not announced — until tomorrow's run. For a bid
 * invitation with a deadline, a day of latency on the fit assessment is most of
 * the value gone. The tail pass scores what this run just triaged.
 */
const TAIL_SHARE = 0.25

/**
 * Ceiling on the WHOLE run, not just the model-bound phases.
 *
 * `budgetMs` used to govern only scoring/triage/drafting, while label, tasks,
 * notify, sheets and hygiene ran after it and added their own time — hygiene
 * alone carried a flat 10-minute budget. So a 50-minute budget produced runs
 * over 60 minutes, past the cron's client timeout, and every single run was
 * recorded as a failure (curl exit 28) despite completing its work. Same shape
 * as the weekly-brief cron fixed on 2026-09-22.
 *
 * Keep this comfortably under the caller's timeout (`-m` in the launchd plist
 * and `maxDuration` on the route), since the deterministic tail is bounded but
 * not instant.
 */
const RUN_BUDGET_MS = 45 * 60 * 1000

/**
 * Held back from the model phases for the deterministic tail.
 *
 * Those phases are what make the run useful to a human — the Gmail labels, the
 * task board, the digest, the rep sheets — so they must never be the part that
 * a long triage squeezes out.
 */
const TAIL_RESERVE_MS = 12 * 60 * 1000

export async function runLeadSweep(opts: LeadSweepOptions = {}): Promise<LeadSweepResult> {
  const phases = opts.phases ?? ALL_PHASES
  const runBudgetMs = opts.budgetMs ?? RUN_BUDGET_MS
  // The model phases get the run budget less the tail reserve; the tail then
  // spends what is genuinely left against the same clock.
  const budgetMs = Math.max(0, runBudgetMs - TAIL_RESERVE_MS)
  const started = Date.now()
  const result: LeadSweepResult = { ranPhases: [], elapsedMs: 0, moreWork: false }

  const remaining = () => budgetMs - (Date.now() - started)
  /** What is left of the WHOLE run — the tail phases measure against this. */
  const runRemaining = () => runBudgetMs - (Date.now() - started)

  if (phases.includes('fetch')) {
    result.fetch = await fetchAllMailboxes({
      pipeline: 'lead',
      maxPagesPerMailbox: 10,
      sinceDays: opts.sinceDays === undefined ? DEFAULT_LEAD_HISTORY_DAYS : opts.sinceDays,
      restart: opts.restart,
    })
    result.ranPhases.push('fetch')
    if (result.fetch.some((f) => !f.done && f.state !== 'failed')) result.moreWork = true
  }

  if (phases.includes('score') && remaining() > 0) {
    result.score = await scorePendingLeads({
      budgetMs: Math.max(0, remaining() * SCORE_SHARE),
      userId: opts.userId,
    })
    result.ranPhases.push('score')
    if (result.score.remaining > 0) result.moreWork = true
  }

  if (phases.includes('triage') && remaining() > 0) {
    result.triage = await triagePendingLeads({
      // Hold a slice back so the leads this pass creates can be scored below
      // rather than waiting a full day for the next run.
      budgetMs: Math.max(0, remaining() * (1 - TAIL_SHARE)),
      userId: opts.userId,
    })
    result.ranPhases.push('triage')
    if (result.triage.remaining > 0) result.moreWork = true

    // Tail pass: score what we just triaged, so notify has something to send.
    if (phases.includes('score') && remaining() > 0 && result.triage.leads > 0) {
      const tail = await scorePendingLeads({
        budgetMs: remaining(),
        userId: opts.userId,
      })
      result.score = result.score
        ? {
            processed: result.score.processed + tail.processed,
            scored: result.score.scored + tail.scored,
            failed: result.score.failed + tail.failed,
            attachmentsStaged: result.score.attachmentsStaged + tail.attachmentsStaged,
            // The tail ran last, so its view of what is left is the current one.
            remaining: tail.remaining,
            outOfTime: tail.outOfTime,
          }
        : tail
      if (tail.remaining > 0) result.moreWork = true
    }
  }

  // ── Route and apply ───────────────────────────────────────────────────────
  // After triage, so a lead created moments ago already has its thread linked to
  // it, and after the tail scoring pass so a promoted lead's link is seeded from
  // a settled state. Both are deterministic and take seconds; neither competes
  // with the model-bound phases above.
  if (phases.includes('route')) {
    result.route = await routeThreads({ limit: ROUTE_BATCH })
    result.ranPhases.push('route')
  }

  if (phases.includes('apply')) {
    result.apply = await applyThreadUpdates({
      limit: APPLY_BATCH,
      budgetMs: Math.max(0, Math.min(remaining(), APPLY_MAX_MS)),
    })
    result.ranPhases.push('apply')
  }

  if (phases.includes('expire')) {
    // Cheap and deterministic — always worth running so the queue self-drains.
    // Position is load-bearing now that this also closes `pass` leads: AFTER
    // both scoring passes, so fit_recommendation has settled; BEFORE label,
    // tasks and notify, so a lead closed here is relabelled in Gmail, has its
    // task closed, and is never announced in a digest it has already left.
    result.expired = await drainLeadQueue()
    result.ranPhases.push('expire')
  }

  if (phases.includes('label')) {
    // After scoring, so a thread is labelled with its final verdict for this
    // run rather than being relabelled minutes later. Cheap and network-bound,
    // so it runs whatever is left on the clock.
    result.labels = await syncLeadLabels()
    result.ranPhases.push('label')
  }

  if (phases.includes('draft') && remaining() > 0) {
    // Model-bound and therefore last of the expensive phases: a draft is a
    // convenience, and it must never eat the budget that scoring — which
    // decides whether anyone looks at the lead at all — needs first.
    result.drafts = await draftLeadReplies({
      budgetMs: Math.max(0, remaining()),
      userId: opts.userId,
    })
    result.ranPhases.push('draft')
    if (result.drafts.outOfTime) result.moreWork = true
  }

  if (phases.includes('tasks')) {
    // Where the calendar sync used to sit, and for a sharper version of its
    // reason. AFTER expire, so a lead whose bid date passed this morning has
    // its task closed in the same run rather than sitting on someone's phone
    // for a day; after the tail scoring pass, so fit_recommendation has
    // settled; BEFORE notify, so the digest and the task board agree about
    // what is due. Unbudgeted: a handful of DB writes, no model, no network.
    result.tasks = await syncLeadTasks()
    result.ranPhases.push('tasks')
  }

  if (phases.includes('notify')) {
    // Last, and outside the budget check: the leads are already scored and
    // stored, and announcing them is what makes them useful. Never throws.
    result.notified = await notifyScoredLeads()
    result.ranPhases.push('notify')
  }

  if (phases.includes('sheets')) {
    // Also outside the budget check, and also cheap: two Drive writes. This is
    // the only way the steel reps and Dino — none of whom have a platform
    // login, and Dino never will — see the queue at all, so it must not be the
    // phase that gets skipped when a long triage overruns.
    result.sheets = await publishLeadSheetsQuietly()
    result.ranPhases.push('sheets')
  }

  if (phases.includes('hygiene') && process.env.LEAD_MAILBOX_HYGIENE !== 'off') {
    // LAST, and on a window rather than the whole inbox.
    //
    // The one-time backfill reads all 8,045 threads and takes ~35 minutes; the
    // routine pass only has to look at what has arrived since, which on a clean
    // inbox is a handful. Running it last also means every other phase has
    // already had its say about this mail — a thread that became a lead today
    // is protected by the time hygiene looks at it.
    try {
      result.hygiene = await runMailboxHygiene({
        sinceDays: HYGIENE_WINDOW_DAYS,
        // Bounded by what is left of the whole run, not a flat ten minutes on
        // top of it — hygiene is the least valuable phase here and must never
        // be what pushes the run past its caller's timeout.
        budgetMs: Math.max(0, Math.min(runRemaining(), 10 * 60 * 1000)),
      })
      result.ranPhases.push('hygiene')
    } catch (err) {
      // Never fatal: the leads are already fetched, scored and announced, and
      // a tidy inbox is worth less than any of that.
      console.error('[leads/hygiene] failed:', err instanceof Error ? err.message : String(err))
    }
  }

  result.elapsedMs = Date.now() - started
  return result
}
