/**
 * Checklist answers → diligence items on a promoted project.
 *
 * The point of collecting a checklist at the front door is that gaps become
 * visible and assignable, rather than sitting in a form submission nobody
 * reopens. Every question becomes a `dd_items` row: answered ones are resolved
 * with the answer kept as evidence, and required ones left blank are open at
 * the severity the checklist declared.
 *
 * Optional questions left blank create nothing. A checklist that manufactures
 * twenty open items on day one is a checklist people learn to ignore.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import type { DdSeverity } from '@/lib/supabase/types'
import { CHECKLIST_BY_KEY, DEAL_CHECKLIST } from './checklist'
import type { ChecklistAnswer } from './parse'

export interface DiligenceSeedResult {
  created: number
  skipped: number
  failed: number
}

interface PendingItem {
  project_id: string
  category: string
  item: string
  severity: DdSeverity
  status: string
  notes: string | null
  resolved_at: string | null
}

/** Tolerant read of the jsonb column, which arrives untyped from the DB. */
export function parseIntakeAnswers(value: unknown): Record<string, ChecklistAnswer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, ChecklistAnswer> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Partial<ChecklistAnswer>
    out[key] = {
      answer: typeof entry.answer === 'string' ? entry.answer : null,
      provided: entry.provided === true,
    }
  }
  return out
}

export async function createDdItemsFromIntake(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
  answers: Record<string, ChecklistAnswer>
): Promise<DiligenceSeedResult> {
  const result: DiligenceSeedResult = { created: 0, skipped: 0, failed: 0 }
  const now = new Date().toISOString()
  const pending: PendingItem[] = []

  for (const spec of DEAL_CHECKLIST) {
    const answer = answers[spec.key]
    const provided = !!answer?.provided && !!answer.answer?.trim()

    if (!provided && !spec.required) {
      result.skipped++
      continue
    }

    pending.push({
      project_id: projectId,
      category: spec.category,
      item: spec.label,
      severity: spec.severity,
      status: provided ? 'resolved' : 'open',
      notes: provided
        ? `Answered at intake: ${answer!.answer!.trim()}`
        : 'Not provided in the intake form.',
      resolved_at: provided ? now : null,
    })
  }

  // An answer under a key the checklist does not know about is still an answer —
  // usually a question the form gained before this list did. Keeping it visible
  // in `other` is how that drift gets noticed.
  for (const [key, answer] of Object.entries(answers)) {
    if (CHECKLIST_BY_KEY[key]) continue
    if (!answer.answer?.trim()) continue
    pending.push({
      project_id: projectId,
      category: 'other',
      item: key,
      severity: 'info',
      status: 'resolved',
      notes: `Answered at intake: ${answer.answer.trim()}`,
      resolved_at: now,
    })
  }

  if (pending.length === 0) return result

  // Idempotent by (project_id, item): re-running an import must not double the
  // Diligence tab. There is no unique constraint to lean on, so existing labels
  // are read once and matched here.
  const { data: existing } = await supabase
    .from('dd_items')
    .select('item')
    .eq('project_id', projectId)

  const have = new Set(((existing ?? []) as { item: string }[]).map((r) => r.item))
  const fresh = pending.filter((p) => !have.has(p.item))
  result.skipped += pending.length - fresh.length
  if (fresh.length === 0) return result

  const { error } = await supabase.from('dd_items').insert(fresh)
  if (error) {
    // Non-fatal by design: the project and its documents already exist, and a
    // missing checklist is a gap to fill, not a reason to fail a promotion.
    console.error('[deal-intake] could not seed diligence items:', error.message)
    result.failed = fresh.length
    return result
  }

  result.created = fresh.length
  return result
}
