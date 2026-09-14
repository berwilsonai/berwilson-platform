/**
 * Fold intake proposals that describe the same deal into one.
 *
 * The queue proposes one record per cluster of correspondence, not one per
 * deal, so a long-running programme arrives as many proposals: 8 for Myton, 8
 * for data centres, 5 for GridEdge, 4 for West Wendover out of 104 real ones.
 * Confirming them as they stand would create eight Myton projects, and a queue
 * that produces duplicates is one nobody will work through.
 *
 * HOW IT MERGES, AND WHY THAT WAY. A group's correspondence is concatenated and
 * re-analysed into ONE of the existing sessions, and the others are dismissed.
 * That reuses every downstream path untouched — the review screen, the confirm
 * route, attachment staging, the fit assessment — because the survivor is an
 * ordinary session that simply covers the whole deal. The alternative, teaching
 * confirm to assemble a record from N sessions, would have meant a second
 * creation path to keep correct forever.
 *
 * Dismissing loses nothing: the threads stay in email_threads and stay
 * searchable by Ber AI, and the folded text is now on the survivor.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import {
  INTAKE_DEDUPE_SYSTEM_PROMPT,
  INTAKE_DEDUPE_PROMPT_VERSION,
  buildDedupeMessage,
  type DedupeEntry,
  type DedupeResult,
} from '@/lib/ai/prompts/intake-dedupe'
import { analyzeEmailReport, SYSTEM_USER_ID, maxInputChars } from './analyze'

/**
 * A group bigger than this is not a programme, it is the grouper having
 * collapsed the queue. Reported and left alone rather than acted on — the same
 * posture as the Drive mass-vanish guard.
 */
const MAX_GROUP = 12

/** Names are cheap to send; the queue is judged in one pass, so cap the input. */
const MAX_ENTRIES = 160

export interface DedupeProgress {
  candidates: number
  groups: number
  merged: number
  folded: number
  failed: number
  heldBack: string[]
  errors: string[]
  outOfTime: boolean
  dryRun: boolean
}

interface SessionRow {
  id: string
  label: string | null
  raw_text: string | null
  extraction_result: Record<string, unknown> | null
  created_at: string
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** What the grouper is shown for one proposal. */
function describe(row: SessionRow, ordinal: number): DedupeEntry {
  const ex = (row.extraction_result ?? {}) as Record<string, Record<string, unknown> | undefined>
  const project = ex.project ?? {}
  const opportunity = ex.opportunity ?? {}
  return {
    ordinal,
    name:
      str(project.name) ??
      str(opportunity.name) ??
      str(row.label) ??
      '(untitled)',
    location: str(project.location) ?? str(opportunity.location),
    counterparty:
      str(project.client) ?? str(opportunity.counterparty) ?? str(opportunity.target),
    summary: str((row.extraction_result as Record<string, unknown>)?.summary),
  }
}

export async function dedupePendingSessions(
  opts: { budgetMs?: number; dryRun?: boolean; userId?: string } = {}
): Promise<DedupeProgress> {
  const deadline = Date.now() + (opts.budgetMs ?? 45 * 60 * 1000)
  const dryRun = opts.dryRun ?? false
  const userId = opts.userId ?? SYSTEM_USER_ID
  const supabase = createAdminClient()

  const progress: DedupeProgress = {
    candidates: 0,
    groups: 0,
    merged: 0,
    folded: 0,
    failed: 0,
    heldBack: [],
    errors: [],
    outOfTime: false,
    dryRun,
  }

  // Only proposals to CREATE. A 'merge' already points at an existing record and
  // a 'dismiss' is on its way out; neither is ours to consolidate.
  const { data, error } = await supabase
    .from('email_intake_sessions')
    .select('id, label, raw_text, extraction_result, created_at')
    .eq('status', 'pending')
    .eq('predecision->>disposition', 'create')
    .order('created_at', { ascending: false })
    .limit(MAX_ENTRIES)
  if (error) throw new Error(`Could not load pending sessions: ${error.message}`)

  const rows = (data ?? []) as unknown as SessionRow[]
  progress.candidates = rows.length
  if (rows.length < 2) return progress

  const entries = rows.map((r, i) => describe(r, i + 1))

  const { data: raw } = await callGemini<DedupeResult | string>({
    task: 'intake-dedupe',
    systemPrompt: INTAKE_DEDUPE_SYSTEM_PROMPT,
    userMessage: buildDedupeMessage(entries),
    userId,
    promptVersion: INTAKE_DEDUPE_PROMPT_VERSION,
    maxTokens: 8192,
  })
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as DedupeResult).groups)) {
    throw new Error('Grouping returned no usable JSON; nothing was changed.')
  }

  // Validate before acting. A grouping that double-counts or invents an ordinal
  // is not partially usable — acting on it would fold the wrong sessions
  // together, and a wrong merge is the one outcome with no undo.
  const seen = new Set<number>()
  const groups: { rows: SessionRow[]; title: string; reason: string }[] = []
  for (const g of (raw as DedupeResult).groups) {
    const members = Array.isArray(g.members) ? g.members : []
    const picked: SessionRow[] = []
    for (const ord of members) {
      const row = rows[Number(ord) - 1]
      if (!row) throw new Error(`Grouping named entry ${ord}, which does not exist.`)
      if (seen.has(Number(ord))) throw new Error(`Grouping put entry ${ord} in two groups.`)
      seen.add(Number(ord))
      picked.push(row)
    }
    if (picked.length === 0) continue
    if (picked.length > MAX_GROUP) {
      progress.heldBack.push(
        `"${g.title}" would fold ${picked.length} proposals into one — refusing above ${MAX_GROUP}; ` +
          `that is a grouper collapsing the queue, not a programme.`
      )
      continue
    }
    groups.push({ rows: picked, title: str(g.title) ?? picked[0].label ?? 'Untitled', reason: str(g.reason) ?? '' })
  }
  // An entry the grouper never mentioned is NOT an error: it simply was not
  // grouped with anything, which is the same outcome as a group of one and the
  // same state it is in today. Only an invented or double-counted ordinal is
  // fatal, because acting on either folds the wrong sessions together — and a
  // wrong merge is the one outcome here with no undo.
  const ungrouped = rows.length - seen.size
  if (ungrouped > 0) {
    progress.heldBack.push(
      `${ungrouped} proposal(s) were not mentioned by the grouper and were left exactly as they are.`
    )
  }
  progress.groups = groups.length + ungrouped

  const cap = maxInputChars()

  for (const group of groups) {
    if (group.rows.length < 2) continue
    if (Date.now() > deadline) {
      progress.outOfTime = true
      break
    }
    if (dryRun) {
      progress.merged++
      progress.folded += group.rows.length - 1
      continue
    }

    // The fullest session survives: it carries the most correspondence, so the
    // re-analysis starts from the best-evidenced view of the deal.
    const ordered = [...group.rows].sort(
      (a, b) => (b.raw_text?.length ?? 0) - (a.raw_text?.length ?? 0)
    )
    const primary = ordered[0]
    const others = ordered.slice(1)

    const combined = ordered
      .map((r) => r.raw_text ?? '')
      .filter(Boolean)
      .join('\n\n---\n\n')

    try {
      await analyzeEmailReport({
        // The model reads a capped slice — several real groups exceed the local
        // context — but the session KEEPS the whole thing, because that stored
        // text becomes the document on the confirmed record. Capping both would
        // quietly drop correspondence from the deal it was merged to preserve.
        rawText: combined.slice(0, cap),
        documentText: combined,
        label: group.title,
        userId,
        sessionId: primary.id,
      })

      await supabase
        .from('email_intake_sessions')
        .update({
          status: 'dismissed',
          predecision: {
            disposition: 'dismiss',
            confidence: 1,
            reason: `Folded into "${group.title}" — the same deal, reviewed there.`,
            prompt_version: INTAKE_DEDUPE_PROMPT_VERSION,
            folded_into: primary.id,
            decided_at: new Date().toISOString(),
          } as unknown as never,
        })
        .in('id', others.map((r) => r.id))

      progress.merged++
      progress.folded += others.length
    } catch (err) {
      progress.failed++
      if (progress.errors.length < 10) {
        progress.errors.push(
          `"${group.title}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  return progress
}
