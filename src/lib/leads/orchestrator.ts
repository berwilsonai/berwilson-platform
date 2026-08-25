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

export type LeadPhase = 'fetch' | 'triage' | 'score' | 'expire'

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
  elapsedMs: number
  moreWork: boolean
}

const ALL_PHASES: LeadPhase[] = ['fetch', 'triage', 'score', 'expire']

export const DEFAULT_LEAD_HISTORY_DAYS = 90

/** Share of the remaining budget scoring may take before triage gets the rest. */
const SCORE_SHARE = 0.4

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
      budgetMs: remaining(),
      userId: opts.userId,
    })
    result.ranPhases.push('triage')
    if (result.triage.remaining > 0) result.moreWork = true
  }

  if (phases.includes('expire')) {
    // Cheap and deterministic — always worth running so the queue self-drains.
    result.expired = await expireStaleLeads()
    result.ranPhases.push('expire')
  }

  result.elapsedMs = Date.now() - started
  return result
}
