/**
 * WHICH DEAL a staged session's follow-ups become tasks on, and the follow-ups
 * themselves.
 *
 * Outside the route because a route file cannot export helpers and this needs
 * exercising directly — the task button runs only when a human clicks, so on the
 * route it would execute for the first time in production. That is the same
 * reasoning as `resolveMergeTarget`, which this delegates to.
 *
 * ⚠ IT RESOLVES, IT NEVER GUESSES, AND IT REUSES THE RESOLVER THE ROW'S OWN
 * PRIMARY ACTION USES. §12: a shared renderer wired to one surface is worse than
 * no shared renderer, and `resolveMeetingTarget` was found answering the
 * record-matching question properly for a meeting's title while the deals a
 * meeting NAMED still went through a trigram threshold. So an email session
 * resolves exactly as merging does, and a meeting resolves exactly as filing
 * does — neither gets a third bar invented for it here.
 *
 * ⚠ AND THE MODEL'S OWN `record_hint` IS DELIBERATELY NOT A TARGET. It names a
 * topic, and §12 is explicit that a model's title names a topic while a human's
 * names a record — only the second may file. A hint that happens to match is
 * reached anyway, through the human title the meeting was filed under.
 */
import { resolveMergeTarget } from '@/lib/email-ingestion/merge-target'
import { resolveMeetingTarget } from '@/lib/meetings/file-notes'
import type { TaskAction } from '@/lib/email-ingestion/defaults'

export type SessionTaskTarget =
  | {
      ok: true
      kind: 'project' | 'opportunity'
      id: string
      name: string
      tasks: TaskAction[]
    }
  | { ok: false; reason: string }

/**
 * The session columns this reads. Narrow on purpose — it needs no more.
 *
 * ⚠ EVERY FIELD IS REQUIRED, AND THAT IS NOT PEDANTRY — IT CAUGHT A LIVE BUG.
 * They were optional first, and /decide's own `select` did not list
 * `match_candidates`: `resolveMergeTarget` therefore saw an empty candidate
 * list for every email session and refused all of them with *"not one of this
 * session's candidate records"*, so the button could never have appeared on a
 * single thread. `tsc` was silent because optional meant absent was legal, and
 * the verification script passed because it selected the column EXPLICITLY —
 * §12 exactly: a fixture that builds the field directly cannot catch a producer
 * that never fills it. Required, the page would not have compiled.
 */
export interface TaskTargetSession {
  intake_kind: string | null
  predecision: unknown
  match_candidates: unknown
  extraction_result: unknown
  /** The title the ORGANISER typed, which is the filing key (§12). */
  source_title: string | null
}

/**
 * Pull the follow-ups out of either extraction shape.
 *
 * ⚠ ONE READER FOR BOTH, because `MeetingIntakeTask` is `TaskAction` minus
 * `include` plus a `record_hint` — and a second reader for the second shape is
 * the sibling-module fork. `include` is defaulted TRUE here: these extractions
 * have no per-task tick (that lives on the review form's own draft), and a
 * default of false would make the button silently do nothing.
 */
export function readExtractionTasks(extraction: unknown): TaskAction[] {
  const o = (extraction ?? {}) as Record<string, unknown>
  const raw = Array.isArray(o.tasks) ? o.tasks : []
  const out: TaskAction[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const r = t as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (!title) continue
    const str = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : ''
      return s || null
    }
    out.push({
      title,
      what: str(r.what),
      why: str(r.why),
      how: str(r.how),
      assignee: str(r.assignee),
      due_date: str(r.due_date),
      include: true,
    })
  }
  return out
}

export async function resolveSessionTaskTarget(
  session: TaskTargetSession
): Promise<SessionTaskTarget> {
  const tasks = readExtractionTasks(session.extraction_result)

  if (session.intake_kind === 'meeting') {
    // ⚠ THE ORGANISER'S TITLE ONLY. The model's rewrite is in `label` and is
    // measurably misleading as a filing key — the call titled "Ber Wilson /
    // Zenthium" came back as "Steelton & Riverdale Site Reviews & Power
    // Capacity Analysis", which would have filed it on either of two deals.
    const typed = session.source_title?.trim()
    if (!typed) {
      return {
        ok: false,
        reason:
          'This call has no title of its own, so there is nothing to resolve a deal from. Open it and file it.',
      }
    }
    const resolved = await resolveMeetingTarget([typed]).catch(() => null)
    if (!resolved?.target) {
      // A suggestion and an ambiguity are different refusals and the reader can
      // act on the difference — one needs confirming, the other needs choosing.
      const why = resolved?.ambiguous
        ? `“${typed}” matches more than one record — ${resolved.ambiguous}.`
        : resolved?.suggestion
          ? `“${typed}” looks like ${resolved.suggestion.name}, but not closely enough to file on it.`
          : `Nothing in the portfolio answers to “${typed}”.`
      return { ok: false, reason: `${why} Open the call and choose the deal.` }
    }
    return {
      ok: true,
      kind: resolved.target.kind,
      id: resolved.target.id,
      name: resolved.target.name,
      tasks,
    }
  }

  // An email session: the same resolution merging uses, so the two buttons on
  // one row can never name different deals.
  const merge = resolveMergeTarget(session.predecision, session.match_candidates)
  if (!merge.ok) return { ok: false, reason: merge.reason }
  const kind = merge.projectId ? 'project' : 'opportunity'
  const id = merge.projectId ?? merge.opportunityId
  if (!id) return { ok: false, reason: 'The matched record has no id.' }
  return { ok: true, kind, id, name: merge.name, tasks }
}
