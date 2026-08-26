/**
 * Pre-decide phase — spend idle model time so the human decides less.
 *
 * The platform was very good at producing things for a human to review and had
 * nothing that made the pile smaller: 104 sessions pending, the oldest six weeks
 * old, while the local model idled at 6% utilisation. The model is free and the
 * executive's attention is not, so the imbalance was the wrong way round.
 *
 * This attaches a recommended disposition to every pending session, and acts
 * ONLY on high-confidence dismissals. Creating a record still requires a human
 * — the invariant in CLAUDE.md §11 is untouched, and deliberately so. What
 * changes is that the human confirms a recommendation instead of reading
 * eighty thousand characters of correspondence to form one.
 *
 * Time-budgeted, commits after every session, newest first, safe to kill at any
 * moment — the same shape as the sweep's other phases.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  INTAKE_PREDECIDE_SYSTEM_PROMPT,
  INTAKE_PREDECIDE_PROMPT_VERSION,
  buildPredecideMessage,
  type IntakePredecision,
  type IntakeDisposition,
} from '@/lib/ai/prompts/intake-predecide'
import { SYSTEM_USER_ID } from './analyze'
import { createAdminClient } from '@/lib/supabase/admin'

/** Matches the deal sweep's cap — ~10k tokens on the local model. */
const MAX_EXCERPT_CHARS = 40_000

const BATCH = 25

/**
 * Only a dismissal this confident is acted on without a human. Set high on
 * purpose: the cost of wrongly dismissing a live pursuit is a lost project,
 * and the cost of leaving one in the queue is a few seconds of skimming.
 */
const AUTO_DISMISS_CONFIDENCE = 0.85

export interface PredecideProgress {
  processed: number
  create: number
  merge: number
  dismiss: number
  autoDismissed: number
  failed: number
  remaining: number
  outOfTime: boolean
}

interface SessionRow {
  id: string
  label: string | null
  raw_text: string | null
  extraction_result: Record<string, unknown> | null
  match_candidates: unknown
  fit_assessment: Record<string, unknown> | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Candidate records are stored in a few shapes across intake kinds. */
function candidateNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      if (typeof c === 'string') return c
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>
        return str(o.name) ?? str(o.title) ?? str(o.project_name) ?? null
      }
      return null
    })
    .filter((n): n is string => !!n)
    .slice(0, 10)
}

function normalise(raw: Partial<IntakePredecision> | null): IntakePredecision | null {
  if (!raw || typeof raw !== 'object') return null
  const d = String(raw.disposition ?? '').toLowerCase()
  if (d !== 'create' && d !== 'merge' && d !== 'dismiss') return null

  const confidence = Number(raw.confidence)
  return {
    disposition: d as IntakeDisposition,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    reason: str(raw.reason) ?? 'No reason given.',
    merge_target_name: str(raw.merge_target_name),
    headline: str(raw.headline),
  }
}

export async function predecidePendingSessions(
  opts: { budgetMs?: number; userId?: string; limit?: number } = {}
): Promise<PredecideProgress> {
  const budgetMs = opts.budgetMs ?? 20 * 60 * 1000
  const deadline = Date.now() + budgetMs
  const supabase = createAdminClient()

  const progress: PredecideProgress = {
    processed: 0,
    create: 0,
    merge: 0,
    dismiss: 0,
    autoDismissed: 0,
    failed: 0,
    remaining: 0,
    outOfTime: false,
  }

  const max = opts.limit ?? Number.POSITIVE_INFINITY

  for (;;) {
    if (Date.now() >= deadline || progress.processed >= max) {
      progress.outOfTime = Date.now() >= deadline
      break
    }

    const { data, error } = await supabase
      .from('email_intake_sessions')
      .select('id, label, raw_text, extraction_result, match_candidates, fit_assessment')
      .eq('status', 'pending')
      .is('predecision', null)
      // Newest first: if the run is cut short, the live pipeline is judged
      // before a six-week-old thread that has already waited.
      .order('created_at', { ascending: false })
      .limit(BATCH)

    if (error) throw new Error(`Could not load pending sessions: ${error.message}`)
    const rows = (data ?? []) as unknown as SessionRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      if (Date.now() >= deadline || progress.processed >= max) {
        progress.outOfTime = Date.now() >= deadline
        break
      }

      try {
        const extraction = row.extraction_result ?? {}
        const fit = row.fit_assessment ?? {}
        const fitScoreRaw = Number(fit.fit_score)

        const { data: raw } = await callGemini<Partial<IntakePredecision>>({
          task: 'intake-predecide',
          systemPrompt: INTAKE_PREDECIDE_SYSTEM_PROMPT,
          userMessage: buildPredecideMessage({
            label: row.label ?? '(untitled)',
            summary: str(extraction.summary),
            suggestedRecord: str(extraction.suggested_record),
            fitRecommendation: str(fit.recommendation),
            fitScore: Number.isFinite(fitScoreRaw) ? fitScoreRaw : null,
            matchCandidates: candidateNames(row.match_candidates),
            excerpt: (row.raw_text ?? '').slice(0, MAX_EXCERPT_CHARS),
          }),
          userId: opts.userId ?? SYSTEM_USER_ID,
          promptVersion: INTAKE_PREDECIDE_PROMPT_VERSION,
        })

        const decision = normalise(typeof raw === 'object' ? raw : null)
        if (!decision) {
          progress.failed++
          progress.processed++
          continue
        }

        // Acting on a confident dismissal is the only automatic write here, and
        // it creates nothing — it moves a session out of the queue with the
        // reason recorded, exactly like the leads module keeps its spam rows.
        const autoDismiss =
          decision.disposition === 'dismiss' && decision.confidence >= AUTO_DISMISS_CONFIDENCE

        await supabase
          .from('email_intake_sessions')
          .update({
            predecision: {
              ...decision,
              decided_at: new Date().toISOString(),
              prompt_version: INTAKE_PREDECIDE_PROMPT_VERSION,
              auto_dismissed: autoDismiss,
            } as unknown as never,
            ...(autoDismiss ? { status: 'dismissed' } : {}),
          })
          .eq('id', row.id)

        progress[decision.disposition]++
        if (autoDismiss) progress.autoDismissed++
        progress.processed++
      } catch (err) {
        console.error(
          `[intake/predecide] ${row.id} failed:`,
          err instanceof Error ? err.message : String(err)
        )
        progress.failed++
        progress.processed++
      }
    }
  }

  const { count } = await supabase
    .from('email_intake_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('predecision', null)
  progress.remaining = count ?? 0

  return progress
}
