/**
 * Sweep orchestration — runs the four phases under one time budget.
 *
 * Shared by the cron driver and the manual "run now" control so both behave
 * identically. The phase order matters: fetch fills the queue, summarize drains
 * it, cluster groups what's been summarized, stage turns groups into reviews.
 *
 * Every phase is independently resumable, so the orchestrator's only real job
 * is dividing the clock. Fetch is network-bound and finishes fast; summarize is
 * the bottleneck and gets whatever is left.
 */

import { fetchAllMailboxes, type FetchProgress } from './fetch-phase'
import { summarizePending, type SummarizeProgress } from './summarize-phase'
import { clusterUnassigned, type ClusterProgress } from './cluster-phase'
import { stageOpenClusters, type StageProgress } from './stage-phase'

export type SweepPhase = 'fetch' | 'summarize' | 'cluster' | 'stage'

export interface SweepRunOptions {
  /** Phases to run, in this order. Defaults to all four. */
  phases?: SweepPhase[]
  /** Total wall-clock budget for the whole run. */
  budgetMs?: number
  /** null = all history. Only applies to a fresh fetch. */
  sinceDays?: number | null
  /** Start the fetch over from page one, discarding the saved cursor. */
  restart?: boolean
  userId?: string
}

export interface SweepRunResult {
  ranPhases: SweepPhase[]
  fetch?: FetchProgress[]
  summarize?: SummarizeProgress
  cluster?: ClusterProgress
  stage?: StageProgress
  elapsedMs: number
  /** True when work remains — the next run should pick up where this left off. */
  moreWork: boolean
}

const ALL_PHASES: SweepPhase[] = ['fetch', 'summarize', 'cluster', 'stage']

/** Share of the budget each phase may consume before yielding to the next. */
const STAGE_SHARE = 0.25

export async function runSweep(opts: SweepRunOptions = {}): Promise<SweepRunResult> {
  const phases = opts.phases ?? ALL_PHASES
  const budgetMs = opts.budgetMs ?? 55 * 60 * 1000
  const started = Date.now()
  const result: SweepRunResult = { ranPhases: [], elapsedMs: 0, moreWork: false }

  const remaining = () => budgetMs - (Date.now() - started)

  if (phases.includes('fetch')) {
    result.fetch = await fetchAllMailboxes({
      maxPagesPerMailbox: 20,
      sinceDays: opts.sinceDays,
      restart: opts.restart,
    })
    result.ranPhases.push('fetch')
    if (result.fetch.some((f) => !f.done && f.state !== 'failed')) result.moreWork = true
  }

  if (phases.includes('stage') && remaining() > 0) {
    // Staging runs BEFORE summarize despite being phase 4: summarize will eat
    // every second it is given, so anything after it would never run. This
    // drains the review queue built by earlier runs first, then yields.
    result.stage = await stageOpenClusters({
      budgetMs: Math.max(0, remaining() * STAGE_SHARE),
      userId: opts.userId,
    })
    result.ranPhases.push('stage')
    if (result.stage.remaining > 0) result.moreWork = true
  }

  if (phases.includes('summarize') && remaining() > 0) {
    result.summarize = await summarizePending({
      budgetMs: remaining(),
      userId: opts.userId,
    })
    result.ranPhases.push('summarize')
    if (result.summarize.remaining > 0) result.moreWork = true
  }

  if (phases.includes('cluster')) {
    // Cheap and deterministic — always worth running last so the threads this
    // run just summarized are grouped and ready for the next run to stage.
    result.cluster = await clusterUnassigned()
    result.ranPhases.push('cluster')
    if (result.cluster.clustersCreated > 0) result.moreWork = true
  }

  result.elapsedMs = Date.now() - started
  return result
}
