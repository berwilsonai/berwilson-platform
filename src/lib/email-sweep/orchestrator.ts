/**
 * Sweep orchestration — runs the phases under one time budget.
 *
 * Shared by the cron driver and the manual "run now" control so both behave
 * identically. The phase order matters: fetch fills the queue, summarize drains
 * it, cluster groups what's been summarized, stage turns groups into reviews,
 * and predecide recommends what to DO with each review so the queue drains.
 *
 * Every phase is independently resumable, so the orchestrator's only real job
 * is dividing the clock. Fetch is network-bound and finishes fast; summarize is
 * the bottleneck and gets whatever is left.
 */

import { fetchAllMailboxes, type FetchProgress } from './fetch-phase'
import { summarizePending, retryStaleFailures, type SummarizeProgress } from './summarize-phase'
import { clusterUnassigned, type ClusterProgress } from './cluster-phase'
import { stageOpenClusters, type StageProgress } from './stage-phase'
import {
  predecidePendingSessions,
  type PredecideProgress,
} from '@/lib/email-ingestion/predecide'
import { routeThreads, type RouteProgress } from './route-phase'
import { applyThreadUpdates, type ApplyProgress } from './apply-phase'
import { embedPendingThreads, type EmbedProgress } from '@/lib/ai/thread-embeddings'
import { extractCommitments, type CommitmentProgress } from '@/lib/commitments/extract-phase'

export type SweepPhase =
  | 'fetch'
  | 'summarize'
  | 'cluster'
  | 'stage'
  | 'route'
  | 'apply'
  | 'embed'
  | 'commitments'
  | 'predecide'

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
  route?: RouteProgress
  apply?: ApplyProgress
  embed?: EmbedProgress
  commitments?: CommitmentProgress
  predecide?: PredecideProgress
  elapsedMs: number
  /** True when work remains — the next run should pick up where this left off. */
  moreWork: boolean
}

const ALL_PHASES: SweepPhase[] = [
  'fetch',
  'summarize',
  'cluster',
  'stage',
  'route',
  'apply',
  'embed',
  'commitments',
  'predecide',
]

/**
 * How many links and threads each run works through.
 *
 * Both phases are deterministic and IO-bound rather than model-bound — 1,600
 * threads route in about twelve seconds — so they are sized to drain a backlog
 * over a few hourly runs without ever competing with summarize for the local
 * model.
 */
const ROUTE_BATCH = 500
const APPLY_BATCH = 100

/**
 * Ceiling on the apply phase, independent of the run's remaining budget.
 *
 * Attachment imports are the slow part (~30s each), and predecide — the only
 * phase that makes the review queue SHRINK — runs after this one. Applying must
 * not eat the whole hour and starve it.
 */
const APPLY_MAX_MS = 10 * 60 * 1000

/** Threads indexed per run, and the ceiling on doing it. */
const EMBED_BATCH = 50
const EMBED_MAX_MS = 10 * 60 * 1000

/**
 * Ceiling on commitment extraction.
 *
 * Model-bound, so it needs a ceiling for the same reason summarize does: it
 * runs before predecide, which deliberately takes whatever is left, and a phase
 * that consumes the remainder starves every phase after it. Cheaper per thread
 * than summarize (a 12k-char tail, not a 40k-char body) and most threads are
 * skipped without an AI call at all, so ten minutes drains a normal day many
 * times over.
 */
const COMMITMENTS_MAX_MS = 10 * 60 * 1000

/** Share of the budget each phase may consume before yielding to the next. */
const STAGE_SHARE = 0.25

/**
 * Ceiling on summarize, as a share of what is left when it starts.
 *
 * ⚠ WITHOUT THIS, EVERY PHASE AFTER SUMMARIZE GETS ZERO. It used to take
 * remaining() outright, so the moment there was any backlog apply, embed and
 * predecide were handed Math.max(0, …) = 0 and tripped outOfTime on their first
 * iteration. Measured consequence: 269 attachment-bearing threads never
 * imported their files, and 27 opportunity documents sat at `pending` embedding
 * with nothing coming for them.
 *
 * Halving summarize costs a slower drain on a large backlog. Leaving it uncapped
 * costs filing, indexing and the only phase that makes the review queue shrink —
 * indefinitely, and silently, because a phase that never runs reports nothing.
 */
const SUMMARIZE_SHARE = 0.5

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
    // Staging runs BEFORE summarize despite being phase 4: summarize is the
    // expensive phase and staging must not queue behind an hour of it. Since
    // SUMMARIZE_SHARE was introduced the phases after summarize do get a budget,
    // but this ordering is still the one that drains last run's clusters first.
    result.stage = await stageOpenClusters({
      budgetMs: Math.max(0, remaining() * STAGE_SHARE),
      userId: opts.userId,
    })
    result.ranPhases.push('stage')
    if (result.stage.remaining > 0) result.moreWork = true
  }

  if (phases.includes('summarize') && remaining() > 0) {
    // Give threads that failed on a transient model outage another chance
    // before draining the queue — bounded to once a day per thread, and only
    // for recent mail, so a poison thread cannot monopolise the budget.
    await retryStaleFailures()
    result.summarize = await summarizePending({
      budgetMs: Math.max(0, remaining() * SUMMARIZE_SHARE),
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

  // ── Route and apply ───────────────────────────────────────────────────────
  // After clustering, so a thread just folded into a confirmed deal is routed in
  // the same run rather than waiting an hour. Before predecide, because both are
  // cheap and predecide deliberately eats whatever budget is left.
  if (phases.includes('route')) {
    result.route = await routeThreads({ limit: ROUTE_BATCH })
    result.ranPhases.push('route')
    if (result.route.threadsConsidered >= ROUTE_BATCH) result.moreWork = true
  }

  if (phases.includes('apply')) {
    result.apply = await applyThreadUpdates({
      limit: APPLY_BATCH,
      budgetMs: Math.max(0, Math.min(remaining(), APPLY_MAX_MS)),
    })
    result.ranPhases.push('apply')
    if (result.apply.outOfTime || result.apply.linksConsidered >= APPLY_BATCH) {
      result.moreWork = true
    }
  }

  // ── Embed ─────────────────────────────────────────────────────────────────
  // After route/apply so a thread is filed before it is indexed, and before
  // predecide, which deliberately consumes whatever budget is left.
  //
  // Cheap by design: embedding is ~220ms per chunk against the local model
  // (measured), so a normal hourly batch is seconds. The exception is a thread
  // carrying attachments, where extraction dominates — hence its own ceiling.
  if (phases.includes('embed')) {
    result.embed = await embedPendingThreads({
      limit: EMBED_BATCH,
      budgetMs: Math.max(0, Math.min(remaining(), EMBED_MAX_MS)),
    })
    result.ranPhases.push('embed')
    if (result.embed.remaining > 0) result.moreWork = true
  }

  // ── Commitments ───────────────────────────────────────────────────────────
  // After route, so a thread already filed to a record hands its scope to the
  // commitments it produces — a commitment that knows its deal is worth far
  // more than a floating one. Before predecide, which takes the remainder.
  if (phases.includes('commitments')) {
    result.commitments = await extractCommitments({
      budgetMs: Math.max(0, Math.min(remaining(), COMMITMENTS_MAX_MS)),
      userId: opts.userId,
    })
    result.ranPhases.push('commitments')
    if (result.commitments.remaining > 0) result.moreWork = true
  }

  if (phases.includes('predecide')) {
    // Last, on whatever budget is left. This is the only phase that makes the
    // review queue SHRINK rather than grow, and it runs on capacity that would
    // otherwise be idle — the model sits unused ~94% of the day.
    result.predecide = await predecidePendingSessions({
      budgetMs: Math.max(0, budgetMs - (Date.now() - started)),
      userId: opts.userId,
    })
    result.ranPhases.push('predecide')
    if (result.predecide.remaining > 0) result.moreWork = true
  }

  result.elapsedMs = Date.now() - started
  return result
}
