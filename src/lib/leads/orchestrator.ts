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
import { scorePendingLeads, expireStaleLeads, type ScoreProgress } from './score-phase'
import { notifyScoredLeads, type LeadNotifyProgress } from './notify-leads'
import { syncLeadDeadlines, type LeadCalendarProgress } from './calendar'

export type LeadPhase = 'fetch' | 'triage' | 'score' | 'expire' | 'notify' | 'calendar'

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
  fetch?: FetchProgress[]
  triage?: TriageProgress
  score?: ScoreProgress
  expired?: number
  notified?: LeadNotifyProgress
  calendar?: LeadCalendarProgress
  elapsedMs: number
  moreWork: boolean
}

const ALL_PHASES: LeadPhase[] = ['fetch', 'triage', 'score', 'expire', 'calendar', 'notify']

export const DEFAULT_LEAD_HISTORY_DAYS = 90

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

export async function runLeadSweep(opts: LeadSweepOptions = {}): Promise<LeadSweepResult> {
  const phases = opts.phases ?? ALL_PHASES
  const budgetMs = opts.budgetMs ?? 50 * 60 * 1000
  const started = Date.now()
  const result: LeadSweepResult = { ranPhases: [], elapsedMs: 0, moreWork: false }

  const remaining = () => budgetMs - (Date.now() - started)

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

  if (phases.includes('expire')) {
    // Cheap and deterministic — always worth running so the queue self-drains.
    result.expired = await expireStaleLeads()
    result.ranPhases.push('expire')
  }

  if (phases.includes('calendar')) {
    // Before notify, so the mail and the calendar agree about what is due.
    result.calendar = await syncLeadDeadlines()
    result.ranPhases.push('calendar')
  }

  if (phases.includes('notify')) {
    // Last, and outside the budget check: the leads are already scored and
    // stored, and announcing them is what makes them useful. Never throws.
    result.notified = await notifyScoredLeads()
    result.ranPhases.push('notify')
  }

  result.elapsedMs = Date.now() - started
  return result
}
