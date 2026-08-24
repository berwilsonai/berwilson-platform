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
  remaining: number
  outOfTime: boolean
  errors: string[]
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
    remaining: 0,
    outOfTime: false,
    errors: [],
  }

  const { data, error } = await db
    .from('thread_clusters')
    .select('id, label, thread_count, first_at, last_at')
    .eq('state', 'open')
    .is('session_id', null)
    .gte('thread_count', opts.minThreads ?? 1)
    .order('last_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(`Could not load open clusters: ${error.message}`)
  const clusters = (data ?? []) as ThreadClusterRow[]

  for (const cluster of clusters) {
    if (progress.staged >= maxClusters) break
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    try {
      const { data: threadData, error: threadErr } = await db
        .from('email_threads')
        .select('subject, mailbox, first_at, last_at, summary, raw_markdown')
        .eq('cluster_id', cluster.id)
        .order('last_at', { ascending: true })

      if (threadErr) throw new Error(threadErr.message)
      const threads = (threadData ?? []) as Pick<
        EmailThreadRow,
        'subject' | 'mailbox' | 'first_at' | 'last_at' | 'summary' | 'raw_markdown'
      >[]

      if (threads.length === 0) {
        // Every thread was reassigned or deleted out from under it.
        await db.from('thread_clusters').update({ state: 'dismissed' }).eq('id', cluster.id)
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
