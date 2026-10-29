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
import {
  applyThreadUpdates,
  importUnparentedAttachments,
  type ApplyProgress,
  type UnparentedProgress,
} from './apply-phase'
import { autoFileDocuments, type AutoFileProgress } from '@/lib/documents/autofile'
import { embedPendingThreads, type EmbedProgress } from '@/lib/ai/thread-embeddings'
import {
  reconcileUnfiledMeetings,
  type ReconcileUnfiledResult,
} from '@/lib/meetings/reconcile-unfiled'
import {
  reconcileMailIndexedDocuments,
  type ReconcileProgress,
} from '@/lib/email-sweep/reconcile-mail-index'
import { extractCommitments, type CommitmentProgress } from '@/lib/commitments/extract-phase'
import {
  promoteInternalCommitments,
  type InternalTaskProgress,
} from '@/lib/commitments/internal-tasks'

export type SweepPhase =
  | 'fetch'
  | 'summarize'
  | 'cluster'
  | 'stage'
  | 'route'
  | 'apply'
  | 'unparented'
  | 'autofile'
  | 'embed'
  | 'meetings'
  | 'commitments'
  | 'internal-tasks'
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
  unparented?: UnparentedProgress
  autofile?: AutoFileProgress
  embed?: EmbedProgress
  reconcile?: ReconcileProgress
  meetings?: ReconcileUnfiledResult
  commitments?: CommitmentProgress
  internalTasks?: InternalTaskProgress
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
  'unparented',
  'autofile',
  'embed',
  'meetings',
  'commitments',
  'internal-tasks',
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

/**
 * Ceiling on importing files off deal mail that belongs to no record.
 *
 * Sized like `apply` and for the same reason — a document AI pass is ~30s on the
 * local model, so 25 threads is the worst case of several minutes. Deliberately
 * SMALLER than the apply batch: the backlog is 422 threads and 809 files, and
 * draining it over a couple of days of hourly runs costs nothing, where taking
 * an hour of every run would starve `embed` and `predecide` behind it.
 *
 * ⚠ RUNS AFTER `apply` AND BEFORE `embed`, which is load-bearing. The orphan
 * document is registered with `skipEmbed: true` — its text is meant to be
 * indexed as `thread_chunks` by the thread's own embed pass, not chunked twice —
 * so `embed` must come after it in the SAME run, or the file sits with no
 * searchable text until the next hour. That ordering is also why the noise-gate
 * widening (20261025000010) is a precondition and not a separate nicety: these
 * are mostly `relevance='noise'` threads, and before that migration `embed`
 * would have withheld every one of them and the text would have gone nowhere.
 */
const UNPARENTED_BATCH = 25
const UNPARENTED_MAX_MS = 8 * 60 * 1000

/** Threads indexed per run, and the ceiling on doing it. */
const EMBED_BATCH = 50
const EMBED_MAX_MS = 10 * 60 * 1000

/**
 * Ceiling on settling the documents the import left to the mail index.
 *
 * Small on purpose. The normal outcome is a grouped read and no work at all —
 * the mail index already holds the text — and the exception embeds from the
 * `extracted_text` already on the row, with no model call. Only a document
 * with no stored text goes back to storage for its bytes, which is the one
 * expensive path and the rare one.
 */
const RECONCILE_MAX_MS = 3 * 60 * 1000

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

  // ── Unparented attachments ────────────────────────────────────────────────
  // Files on deal mail the router could not place. See
  // `importUnparentedAttachments` for the measurement; the short version is
  // that attachment import required a `thread_links` row and only 12% of deal
  // threads have one, so 809 files were in no corpus at all.
  if (phases.includes('unparented') && remaining() > 0) {
    result.unparented = await importUnparentedAttachments({
      limit: UNPARENTED_BATCH,
      budgetMs: Math.max(0, Math.min(remaining(), UNPARENTED_MAX_MS)),
    })
    result.ranPhases.push('unparented')
    if (result.unparented.outOfTime || result.unparented.threadsPending > UNPARENTED_BATCH) {
      result.moreWork = true
    }
  }

  // ── Documents that name their own deal ────────────────────────────────────
  // Immediately after `unparented`, which is what just created most of them: a
  // file that arrived this run and says "GridEdge" in its own name should be on
  // GridEdge before anybody opens the queue, not waiting in it.
  //
  // ⚠ NOT A SECOND MATCHER. It reads the same two queues /decide reads and acts
  // only on the subset whose name carries the record's WHOLE name — see the
  // header of autofile.ts for the bar, and for the measured reason an asserted
  // alias is deliberately not enough.
  if (phases.includes('autofile') && remaining() > 0) {
    try {
      result.autofile = await autoFileDocuments()
      result.ranPhases.push('autofile')
    } catch (err) {
      // Never fails the run. This is a convenience over a queue that still
      // works by hand, so a throw here must not cost the phases after it —
      // embed and commitments are the ones nobody can do manually.
      console.error('[sweep] autofile failed:', err instanceof Error ? err.message : err)
    }
  }

  // ── Meetings ──────────────────────────────────────────────────────────────
  // ⚠ RUN UNCONDITIONALLY AND AFTER `apply`, WHICH IS THE WHOLE POINT. §12: a
  // cleanup that is a side effect of having work to do never reaches the rows
  // with no work. A meeting on no record is exactly such a row — its intake
  // session may have been dismissed months ago, and `/decide` reads sessions
  // rather than meetings, so nothing else would ever look at it again. Nine
  // real calls, the oldest from August, were sitting invisible on 2026-10-21.
  //
  // After `apply` because routing may have just filed the thread a recording
  // produced, and after `route` for the same reason: the alias that reaches a
  // record is the same key both passes use. Cheap — a handful of rows behind a
  // partial index, no model call.
  if (phases.includes('meetings')) {
    result.meetings = await reconcileUnfiledMeetings()
    result.ranPhases.push('meetings')
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

    // ⚠ THE TAIL OF THIS PHASE, NOT A PHASE OF ITS OWN, AND THE ORDER IS THE
    // WHOLE POINT. `apply` imports an attachment and defers its indexing
    // decision (`skipEmbed`) because `thread_chunks` is empty for that thread
    // until the lines above have run. Only here is the mail index
    // authoritative, so only here can a document be asked whether its text is
    // already searchable — and whatever the mail index could not read (an
    // xlsx, a pptx, a failed byte fetch) gets indexed as a document after all.
    //
    // Runs whenever `embed` does, with no `moreWork` of its own: it is bounded
    // by its own batch and settles what the run just created. A leftover is
    // picked up by the next run, which is where it belongs — the alternative
    // was the sweep refusing to finish on a backlog it has already handled.
    result.reconcile = await reconcileMailIndexedDocuments({
      budgetMs: Math.max(0, Math.min(remaining(), RECONCILE_MAX_MS)),
    })
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

  // ── Internal obligations onto the board ───────────────────────────────────
  // Immediately after extraction, so an item Eric texted this evening is a task
  // before the morning note is composed. Deterministic and unbudgeted: a couple
  // of reads and one insert per new obligation, no model and no network. See
  // internal-tasks.ts for why this is allowed to create a record without a
  // human confirm, and what bounds it.
  if (phases.includes('internal-tasks')) {
    result.internalTasks = await promoteInternalCommitments()
    result.ranPhases.push('internal-tasks')
    const moved =
      result.internalTasks.created + result.internalTasks.closed + result.internalTasks.reopened
    if (moved > 0) {
      // The board publishes to a shared Google Sheet; a row added here has to
      // reach the phone the same hour, not at the next quarter-hour refresh.
      const { queueTaskSheetRefresh } = await import('@/lib/tasks/sheet-refresh')
      queueTaskSheetRefresh()
    }
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
