/**
 * Sweep phase 2 — MAP (summarize).
 *
 * Turns each pending thread into a compact ThreadSummary via one AI call.
 * This is the expensive phase: on the local model (qwen3.6-35b-a3b) a thread
 * costs roughly 25-50 seconds, so a full backfill is measured in hours or days,
 * not minutes.
 *
 * Everything here follows from that. The phase is time-budgeted rather than
 * count-budgeted, commits after every single thread, and is safe to kill at any
 * moment — the next run picks up the remaining `pending` rows. Nothing is ever
 * lost, and no run has to finish.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  THREAD_SUMMARY_SYSTEM_PROMPT,
  THREAD_SUMMARY_PROMPT_VERSION,
  type ThreadSummary,
} from '@/lib/ai/prompts/thread-summary'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { sweepDb, type EmailThreadRow } from './db'

/**
 * Hard ceiling on thread text sent to the model. The local model has 64k
 * context loaded; ~40k chars is ~10k tokens, which leaves ample room for the
 * prompt and the reasoning tokens Qwen emits before answering.
 */
const MAX_THREAD_CHARS = 40_000

/** Threads pulled per database round trip. */
const BATCH = 25

export interface SummarizeProgress {
  processed: number
  summarized: number
  failed: number
  remaining: number
  byRelevance: { deal: number; operational: number; noise: number }
  outOfTime: boolean
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Normalize raw model output; never trust the enum or the array shapes. */
function normalize(raw: unknown): ThreadSummary {
  const r = (raw ?? {}) as Partial<ThreadSummary>
  const relevance =
    r.relevance === 'deal' || r.relevance === 'operational' ? r.relevance : 'noise'

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []

  return {
    relevance,
    // A deal name is meaningless on a non-deal thread and would pollute clustering.
    deal_name: relevance === 'deal' ? nullableStr(r.deal_name) : null,
    counterparty: nullableStr(r.counterparty),
    sector: nullableStr(r.sector),
    location: nullableStr(r.location),
    estimated_value:
      typeof r.estimated_value === 'number' && isFinite(r.estimated_value)
        ? r.estimated_value
        : null,
    stage_signal: nullableStr(r.stage_signal),
    people: Array.isArray(r.people)
      ? r.people
          .filter((p) => p && nullableStr(p.name))
          .map((p) => ({
            name: (p.name as string).trim(),
            email: nullableStr(p.email),
            company: nullableStr(p.company),
            title: nullableStr(p.title),
            role: nullableStr(p.role),
            is_organization: p.is_organization === true,
          }))
      : [],
    key_facts: strings(r.key_facts),
    open_items: strings(r.open_items),
    summary: nullableStr(r.summary) ?? '',
    confidence:
      typeof r.confidence === 'number' && isFinite(r.confidence) ? r.confidence : 0,
  }
}

/**
 * Summarize pending threads until the time budget runs out.
 *
 * @param budgetMs  Stop starting new threads once this much time has passed.
 *                  The in-flight thread still finishes, so allow headroom
 *                  under any hard timeout above this.
 */
export async function summarizePending(
  opts: { budgetMs?: number; maxThreads?: number; userId?: string } = {}
): Promise<SummarizeProgress> {
  const budgetMs = opts.budgetMs ?? 50 * 60 * 1000 // 50 minutes
  const maxThreads = opts.maxThreads ?? Infinity
  const userId = opts.userId ?? SYSTEM_USER_ID
  const db = sweepDb()
  const deadline = Date.now() + budgetMs

  const progress: SummarizeProgress = {
    processed: 0,
    summarized: 0,
    failed: 0,
    remaining: 0,
    byRelevance: { deal: 0, operational: 0, noise: 0 },
    outOfTime: false,
  }

  while (progress.processed < maxThreads) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    // Newest first: if the run is cut short, the CRM gets the live pipeline
    // before it gets 2019's archive.
    const { data, error } = await db
      .from('email_threads')
      .select('id, subject, raw_markdown, last_at')
      .eq('summary_state', 'pending')
      .order('last_at', { ascending: false })
      .limit(BATCH)

    if (error) throw new Error(`Could not load pending threads: ${error.message}`)
    const rows = (data ?? []) as Pick<EmailThreadRow, 'id' | 'subject' | 'raw_markdown' | 'last_at'>[]
    if (rows.length === 0) break

    for (const row of rows) {
      if (Date.now() >= deadline || progress.processed >= maxThreads) {
        progress.outOfTime = Date.now() >= deadline
        break
      }

      const text = (row.raw_markdown ?? '').slice(0, MAX_THREAD_CHARS)
      if (!text.trim()) {
        await db
          .from('email_threads')
          .update({ summary_state: 'skipped', summary_error: 'Thread had no readable text.' })
          .eq('id', row.id)
        progress.processed++
        continue
      }

      try {
        const { data: raw } = await callGemini<Partial<ThreadSummary>>({
          task: 'thread-summary',
          systemPrompt: THREAD_SUMMARY_SYSTEM_PROMPT,
          userMessage: text,
          userId,
          promptVersion: THREAD_SUMMARY_PROMPT_VERSION,
          maxTokens: 4096,
        })

        // A non-object means the model returned prose instead of JSON.
        if (!raw || typeof raw !== 'object') {
          throw new Error('Model did not return JSON.')
        }

        const summary = normalize(raw)
        const { error: updateErr } = await db
          .from('email_threads')
          .update({
            summary,
            summary_state: 'summarized',
            summary_error: null,
          })
          .eq('id', row.id)
        if (updateErr) throw new Error(updateErr.message)

        progress.summarized++
        progress.byRelevance[summary.relevance]++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[sweep/summarize] thread ${row.id} failed:`, message)
        await db
          .from('email_threads')
          .update({ summary_state: 'failed', summary_error: message.slice(0, 500) })
          .eq('id', row.id)
        progress.failed++
      }

      progress.processed++
    }
  }

  const { count } = await db
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .eq('summary_state', 'pending')
  progress.remaining = count ?? 0

  return progress
}

/**
 * Requeue threads whose summary failed, so a transient LM Studio outage or a
 * one-off bad JSON response doesn't permanently drop them from the sweep.
 */
export async function retryFailedSummaries(): Promise<number> {
  const db = sweepDb()
  const { data, error } = await db
    .from('email_threads')
    .update({ summary_state: 'pending', summary_error: null })
    .eq('summary_state', 'failed')
    .select('id')

  if (error) throw new Error(`Could not requeue failed threads: ${error.message}`)
  return data?.length ?? 0
}
