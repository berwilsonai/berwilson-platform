/**
 * Sweep phase 4 — REDUCE (stage for review).
 *
 * Turns one cluster into one pending email_intake_sessions row, using the same
 * analyzer the manual paste flow uses. Nothing is created in the CRM here: the
 * human still reviews and confirms, exactly as before.
 *
 * The model reads the cluster's thread SUMMARIES, not the original mail. A deal
 * that ran across a dozen threads is thousands of lines of raw email but only a
 * page or two of summaries, which is what keeps the reduce inside the local
 * model's context no matter how long the correspondence ran.
 *
 * The full raw correspondence is still preserved — it's passed as the session's
 * document text, so the report attached to the confirmed record is the real
 * thing rather than a summary of a summary.
 */

import { analyzeEmailReport, EmailIntakeError, SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import type { ThreadSummary } from '@/lib/ai/prompts/thread-summary'
import { sweepDb, type EmailThreadRow, type ThreadClusterRow } from './db'
import { refreshClusterRollups } from './cluster-phase'

/** Raw correspondence kept on the session for the permanent record document. */
const MAX_DOCUMENT_CHARS = 400_000

export interface StageProgress {
  staged: number
  failed: number
  /** Clusters that did not clear the staging bar. See `clusterStagingVerdict`. */
  held: number
  remaining: number
  outOfTime: boolean
  errors: string[]
}

/**
 * WHETHER A CLUSTER OF CORRESPONDENCE IS WORTH PUTTING IN FRONT OF A HUMAN.
 *
 * ⚠ MEASURED, NOT CHOSEN, AND THE MEASUREMENT IS THE WHOLE REASON THIS EXISTS.
 * Until 2026-10-20 the gate was `thread_count >= 1`, which is no gate at all:
 * every distinguishable topic in two executives' mailboxes became a candidate
 * project. Of 225 sessions staged that way, 251 were decided and FOUR were
 * confirmed — a 1.6% yield — and on 10-20 Richard dismissed 119 in one sitting,
 * 92 of them carrying the model's own confident `create`. The labels say why:
 * "Due Diligence Letter", "Compton", "Alex Wells new home", "Big Client
 * Pursuit", and a dozen federal bid NOTICES that belong on /leads. Those are
 * conversations, not deals.
 *
 * The two conditions below are the only ones in the staged corpus that
 * discriminated. Counted over all 225 sessions against what Richard actually
 * confirmed:
 *
 *   gate                                    queue    confirms kept (of 4)
 *   ───────────────────────────────────────────────────────────────────────
 *   thread_count >= 1  (what shipped)         225     4
 *   an attachment anywhere in the cluster     122     4
 *   somebody replied (message_count > 1)      114     3
 *   attachment AND a reply                     62     3
 *   thread_count > 1                           49     2
 *   (attachment AND reply) OR >1 thread        84     4   ← this
 *
 * So: 225 → 84, losing none of the four. 103 sessions had no attachment
 * anywhere and produced ZERO confirmations; 111 came from a cluster whose
 * busiest thread was a single message and produced one.
 *
 * ⚠ THE EVIDENCE IS STRONG ABOUT WHAT TO DROP AND WEAK ABOUT WHAT TO KEEP.
 * Four positives cannot validate a gate; what they can do is rule one out, and
 * every tighter gate above drops a confirmation. So this is deliberately the
 * LOOSEST rule that keeps all four, not the tightest that fits.
 *
 * WHY THESE TWO FACTS AND NOT A SCORE. Both are structural — they are counts
 * Gmail gave us, not judgements a model made — which is the same shape as the
 * recording gate in §11 that went from 9-wrong-out-of-9 to 0 by refusing to
 * read intent and requiring a fact instead. A reply means somebody here
 * engaged; an attachment means paper moved. A single unanswered message with
 * nothing attached is a notice, and a notice is searchable in `thread_chunks`
 * without anybody deciding anything about it — which is Richard's own point:
 * Ber AI can already read the mailbox, so staging adds a decision, not an
 * answer.
 *
 * NOTHING IS LOST BY FAILING THIS. The threads stay in `email_threads`, stay
 * summarized, stay indexed, stay routable onto a record, and the cluster is
 * HELD rather than dismissed — so when a reply or an attachment arrives,
 * `clusterUnassigned` attaches it, reopens the cluster, and this runs again.
 */
export function clusterStagingVerdict(
  threads: Array<Pick<EmailThreadRow, 'message_count' | 'attachment_count'>>
): { stage: boolean; reason: string } {
  if (threads.length > 1) {
    return { stage: true, reason: `${threads.length} threads on one deal` }
  }
  const attachments = threads.reduce((n, t) => n + (t.attachment_count ?? 0), 0)
  const busiest = threads.reduce((n, t) => Math.max(n, t.message_count ?? 0), 0)
  if (attachments > 0 && busiest > 1) {
    return {
      stage: true,
      reason: `${busiest} messages and ${attachments} attachment${attachments === 1 ? '' : 's'}`,
    }
  }
  // Named in full, because this string is what /intake and the agent's
  // intake-status tool report back when somebody asks why a deal they remember
  // is not in the queue.
  if (attachments === 0 && busiest <= 1) {
    return { stage: false, reason: 'held: one message, nothing attached, no reply' }
  }
  if (attachments === 0) {
    return { stage: false, reason: `held: ${busiest} messages but nothing attached` }
  }
  return { stage: false, reason: `held: ${attachments} attachment(s) but nobody replied` }
}

/** Render one cluster's summaries into the compact report the model reads. */
export function renderClusterReport(
  cluster: Pick<ThreadClusterRow, 'label' | 'thread_count' | 'first_at' | 'last_at'>,
  threads: Pick<EmailThreadRow, 'subject' | 'mailbox' | 'first_at' | 'last_at' | 'summary'>[]
): string {
  const lines: string[] = [
    `# Email research: ${cluster.label ?? 'untitled deal'}`,
    `Assembled from ${threads.length} email thread(s) across the connected mailboxes` +
      (cluster.first_at && cluster.last_at
        ? `, ${cluster.first_at.slice(0, 10)} to ${cluster.last_at.slice(0, 10)}`
        : '') +
      '.',
    '',
    'Each section below is a structured summary of one thread, produced when the',
    'thread was read. Treat them as the evidence for a single deal.',
    '',
  ]

  threads.forEach((t, i) => {
    const s = t.summary as ThreadSummary | null
    if (!s) return
    lines.push(`## Thread ${i + 1}: ${t.subject ?? '(no subject)'}`)
    lines.push(
      `Mailbox: ${t.mailbox} · ${(t.first_at ?? '').slice(0, 10)} to ${(t.last_at ?? '').slice(0, 10)}`
    )
    lines.push('')
    if (s.summary) lines.push(s.summary, '')

    const facts: string[] = []
    if (s.counterparty) facts.push(`Counterparty: ${s.counterparty}`)
    if (s.sector) facts.push(`Sector: ${s.sector}`)
    if (s.location) facts.push(`Location: ${s.location}`)
    if (s.estimated_value != null) facts.push(`Value discussed: ${s.estimated_value}`)
    if (s.stage_signal) facts.push(`Stage signal: ${s.stage_signal}`)
    if (facts.length) lines.push(...facts.map((f) => `- ${f}`), '')

    if (s.people.length) {
      lines.push('People:')
      for (const p of s.people) {
        const bits = [p.name, p.title, p.company, p.email].filter(Boolean).join(' · ')
        lines.push(`- ${bits}${p.role ? ` — ${p.role}` : ''}`)
      }
      lines.push('')
    }
    if (s.key_facts.length) lines.push('Key facts:', ...s.key_facts.map((f) => `- ${f}`), '')
    if (s.open_items.length) lines.push('Open items:', ...s.open_items.map((f) => `- ${f}`), '')
  })

  return lines.join('\n')
}

/** Assemble the full raw correspondence for the permanent record document. */
function renderClusterDocument(
  label: string,
  threads: Pick<EmailThreadRow, 'raw_markdown'>[]
): string {
  const body = threads
    .map((t) => t.raw_markdown ?? '')
    .filter(Boolean)
    .join('\n\n---\n\n')
  const header = `# Email correspondence: ${label}\n\nFull text of every thread grouped into this deal.\n\n`
  return (header + body).slice(0, MAX_DOCUMENT_CHARS)
}

/**
 * Stage open clusters as pending review sessions, newest first.
 *
 * Time-budgeted like the map phase: each cluster costs one AI call plus the
 * matcher/fit passes, so a large first sweep stages over several runs.
 */
export async function stageOpenClusters(
  opts: { budgetMs?: number; maxClusters?: number; userId?: string; minThreads?: number } = {}
): Promise<StageProgress> {
  const budgetMs = opts.budgetMs ?? 30 * 60 * 1000
  const maxClusters = opts.maxClusters ?? Infinity
  const userId = opts.userId ?? SYSTEM_USER_ID
  const db = sweepDb()
  const deadline = Date.now() + budgetMs

  const progress: StageProgress = {
    staged: 0,
    failed: 0,
    held: 0,
    remaining: 0,
    outOfTime: false,
    errors: [],
  }

  const load = (state: 'open' | 'held', limit: number) =>
    db
      .from('thread_clusters')
      .select('id, label, thread_count, first_at, last_at')
      .eq('state', state)
      .is('session_id', null)
      .gte('thread_count', opts.minThreads ?? 1)
      .order('last_at', { ascending: false })
      .limit(limit)

  // ⚠ 'held' IS READ BACK, NOT JUST WRITTEN — AND IN A SECOND QUERY, AFTER THE
  // OPEN ONES. A held cluster that later absorbs a thread is reopened by
  // `clusterUnassigned`, so growth already brings it back as 'open'; reading
  // held ones as well means a cluster held under an OLDER version of
  // `clusterStagingVerdict` is re-judged by the current one rather than being
  // stranded by a rule that has since changed. Two queries rather than one
  // `.in()` because held rows accumulate and share the newest-first ordering:
  // a single capped query would eventually let 500 held clusters crowd out the
  // open one that actually needs staging, which is the failure mode of every
  // "it is in the same list" shortcut. The verdict runs before any model call,
  // so re-reading a held cluster costs one cheap query and nothing else.
  const [openRes, heldRes] = await Promise.all([load('open', 500), load('held', 200)])
  if (openRes.error) throw new Error(`Could not load open clusters: ${openRes.error.message}`)
  const clusters = [
    ...((openRes.data ?? []) as ThreadClusterRow[]),
    ...((heldRes.data ?? []) as ThreadClusterRow[]),
  ]

  for (const cluster of clusters) {
    if (progress.staged >= maxClusters) break
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    try {
      const { data: threadData, error: threadErr } = await db
        .from('email_threads')
        .select(
          'subject, mailbox, first_at, last_at, summary, raw_markdown, message_count, attachment_count'
        )
        .eq('cluster_id', cluster.id)
        .order('last_at', { ascending: true })

      if (threadErr) throw new Error(threadErr.message)
      const threads = (threadData ?? []) as Pick<
        EmailThreadRow,
        | 'subject'
        | 'mailbox'
        | 'first_at'
        | 'last_at'
        | 'summary'
        | 'raw_markdown'
        | 'message_count'
        | 'attachment_count'
      >[]

      if (threads.length === 0) {
        // Every thread was reassigned or deleted out from under it.
        await db.from('thread_clusters').update({ state: 'dismissed' }).eq('id', cluster.id)
        continue
      }

      // ⚠ BEFORE THE MODEL CALL, DELIBERATELY. The verdict reads two integers
      // Gmail already gave us, so a cluster that does not clear the bar costs
      // nothing — no extraction, no matcher, no fit pass, no 30-60s of a
      // server that serves one request at a time. Measured on the staged
      // corpus this skips 141 of 225, which is 141 extraction passes a day the
      // box was spending to produce rows a human then dismissed.
      const verdict = clusterStagingVerdict(threads)
      if (!verdict.stage) {
        await db
          .from('thread_clusters')
          .update({ state: 'held', reason: verdict.reason })
          .eq('id', cluster.id)
        progress.held++
        continue
      }

      const report = renderClusterReport(cluster, threads)
      const document = renderClusterDocument(cluster.label ?? 'untitled deal', threads)

      const analysis = await analyzeEmailReport({
        rawText: report,
        documentText: document,
        label: cluster.label,
        userId,
      })

      const { error: linkErr } = await db
        .from('thread_clusters')
        .update({ state: 'staged', session_id: analysis.session_id })
        .eq('id', cluster.id)
      if (linkErr) throw new Error(linkErr.message)

      // Backlink so the review screen can show which threads produced it.
      await db
        .from('email_intake_sessions')
        .update({ cluster_id: cluster.id })
        .eq('id', analysis.session_id)

      progress.staged++
    } catch (err) {
      const message =
        err instanceof EmailIntakeError ? err.message : err instanceof Error ? err.message : String(err)
      console.error(`[sweep/stage] cluster ${cluster.id} failed:`, message)
      progress.errors.push(`${cluster.label ?? cluster.id}: ${message.slice(0, 200)}`)
      progress.failed++
    }
  }

  const { count } = await db
    .from('thread_clusters')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'open')
    .is('session_id', null)
  progress.remaining = count ?? 0

  return progress
}

/**
 * Dismiss a cluster without staging it, releasing its threads so a later run
 * can regroup them. Used by the review UI's "not a deal" action.
 */
export async function dismissCluster(clusterId: string, releaseThreads = false): Promise<void> {
  const db = sweepDb()
  await db.from('thread_clusters').update({ state: 'dismissed' }).eq('id', clusterId)
  if (releaseThreads) {
    await db.from('email_threads').update({ cluster_id: null }).eq('cluster_id', clusterId)
  } else {
    await refreshClusterRollups(clusterId)
  }
}
