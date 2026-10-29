/**
 * Re-ask where every staged session belongs, against the portfolio as it is
 * TODAY.
 *
 * ⚠ THE QUEUE'S RECOMMENDATIONS GO STALE AND NOTHING WAS RE-ASKING THEM. A
 * session's `match_candidates` are computed once, when the correspondence is
 * staged, and its `predecision` is formed from that frozen list. Every record
 * created afterwards is invisible to both. So a thread staged in July, about a
 * deal that became a project in September, still offers "Create project" — and
 * the person reading /decide can see in a second that it belongs to the record
 * sitting two rows above it. Richard, 2026-10-28: *"Most seem so obvious where
 * they belong."*
 *
 * Measured the same day on the live queue of four: `GridEdgeDC` carried
 * `Heber Development` and `Myton Development` at 0.38 trigram, against an
 * opportunity named **GridEdge**; `Firm Power IPP Partnership` carried no
 * candidates at all. Not one of the four had the right answer in its list.
 *
 * ⚠ IT CHANGES A RECOMMENDATION AND NOTHING ELSE. No record is created, nothing
 * is filed, no session is confirmed or dismissed. What a run does is make the
 * row's button read "File onto GridEdge" instead of "Create project", which a
 * human then presses or ignores. §11 is untouched, and deliberately so.
 *
 * ⚠ IT NEVER DOWNGRADES. A session the model declines to place keeps whatever
 * recommendation it had, because the alternative is a pass that clears good
 * verdicts every time it runs and makes the queue worse the more often you use
 * it.
 */

import { callGemini } from '@/lib/ai/gemini'
import { wireReasoning } from '@/lib/ai/reasoning'
import {
  DECIDE_RESCRUB_PROMPT_VERSION,
  DECIDE_RESCRUB_REASONING,
  DECIDE_RESCRUB_SYSTEM_PROMPT,
  buildRescrubMessage,
  type DecideRescrubAnswer,
} from '@/lib/ai/prompts/decide-rescrub'
import { INTAKE_PREDECIDE_PROMPT_VERSION } from '@/lib/ai/prompts/intake-predecide'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTargets } from '@/lib/email-sweep/route-phase'
import type { JsonIn } from '@/lib/supabase/types'

/** Matches the pre-decide phase's cap — ~10k tokens on the local model. */
const MAX_EXCERPT_CHARS = 40_000

/**
 * Below this the answer is not written.
 *
 * ⚠ IT IS A BAR ON A RECOMMENDATION, NOT ON A WRITE TO A DEAL, which is why it
 * sits well below `AUTO_DISMISS_CONFIDENCE`. Nothing moves on this number: it
 * decides whether a button says "File onto GridEdge" or stays "Create project",
 * and the person reads the deal's name before pressing either. A bar high
 * enough to be safe for an unattended write would discard exactly the
 * half-remembered matches a human is best placed to confirm.
 */
const MIN_CONFIDENCE = 0.6

export interface RescrubProgress {
  /** Sessions looked at. */
  examined: number
  /** Sessions whose recommendation now names an existing record. */
  placed: number
  /** Sessions the model declined to place — left exactly as they were. */
  unplaced: number
  /** Sessions already recommended for the record the model named. */
  unchanged: number
  failed: number
  /** What changed, newest first, for the toast and the log. */
  changes: Array<{ id: string; label: string; record: string; reason: string }>
}

interface SessionRow {
  id: string
  label: string | null
  raw_text: string | null
  extraction_result: Record<string, unknown> | null
  match_candidates: unknown
  predecision: unknown
}

export interface RegisterEntry {
  kind: 'project' | 'opportunity'
  id: string
  name: string
  /** `name` folded for comparison — the ONLY key the model's reply resolves on. */
  key: string
}

function fold(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Every project and opportunity, as the model will be shown them.
 *
 * `loadTargets()` rather than a fresh query: it is the list the mail router,
 * the document picker and `/documents/unfiled` already match against, so a
 * record this pass can name is a record those can file onto (§12 — a shared
 * renderer wired to one surface, and the same for a shared list).
 *
 * ⚠ A NAME CLAIMED BY TWO RECORDS IS DROPPED FROM BOTH. The model answers with
 * a name and nothing else, so a duplicate name is not resolvable to an id —
 * and resolving it to the first hit would file a conversation onto a coin
 * flip. §12: an alias claimed by two records makes BOTH unmatchable.
 */
export function buildRegister(
  rows: Array<{ kind: string; id: string; name: string | null }>
): RegisterEntry[] {
  const byKey = new Map<string, RegisterEntry[]>()
  for (const t of rows) {
    if (t.kind !== 'project' && t.kind !== 'opportunity') continue
    const name = (t.name ?? '').trim()
    if (!name) continue
    const key = fold(name)
    const list = byKey.get(key) ?? []
    list.push({ kind: t.kind, id: t.id, name, key })
    byKey.set(key, list)
  }
  return [...byKey.values()]
    .filter((list) => list.length === 1)
    .map((list) => list[0])
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The register as it stands, read from the shared target list. */
export async function loadRegister(): Promise<RegisterEntry[]> {
  return buildRegister(await loadTargets())
}

/**
 * Turn the model's reply into a record, or refuse.
 *
 * ⚠ THE ONE SAFETY PROPERTY OF HANDING A MODEL A LIST IS CHECKING THE REPLY
 * BACK AGAINST IT. A name it tidied, abbreviated, translated or invented must
 * fail here rather than nearly match — "Steelton" is not
 * "Steelton — Cleveland-Cliffs (PA)" and must not resolve to it, because the
 * next invented name would be a deal we do not have. Whole name, case- and
 * whitespace-folded, nothing else.
 */
export function resolveRescrubAnswer(
  register: RegisterEntry[],
  answer: { record?: unknown; confidence?: unknown } | null,
  minConfidence = MIN_CONFIDENCE
): RegisterEntry | null {
  const named = str(answer?.record)
  if (!named) return null
  const confidence = Number(answer?.confidence)
  if (!Number.isFinite(confidence) || confidence < minConfidence) return null

  const byKey = (k: string) => register.find((e) => e.key === k) ?? null
  // The reply as given, which is the only thing a correct answer needs.
  const exact = byKey(fold(named))
  if (exact) return exact

  /*
    ⚠ ONE TOLERANCE, AND IT UNDOES THE PROMPT'S OWN DECORATION — NOT THE
    MODEL'S IMAGINATION.

    The register is SHOWN as "[opportunity] GridEdge" so the reader of the
    prompt can tell a project from an opportunity. On the first live run the
    model answered `"GridEdge (opportunity)"` at 0.95 against a thread whose
    body executes a mutual NDA with GridEdgeDC — the right record, refused,
    because the tag it had been shown came back glued to the name.

    So the type tag is stripped in either position and the remainder is looked
    up as a WHOLE key again. That is not a fuzzy match and it must not become
    one: no prefix, no substring, no similarity. If stripping the tag does not
    land exactly on a register key, the answer is still refused — and a record
    genuinely called "Something (project)" is unaffected, because the untouched
    reply is tried first.
  */
  const undecorated = named
    .replace(/^\s*[[(](?:project|opportunity)[\])]\s*/i, '')
    .replace(/\s*[[(](?:project|opportunity)[\])]\s*$/i, '')
  if (undecorated !== named) return byKey(fold(undecorated))
  return null
}

/**
 * A candidate entry in the shape `resolveMergeTarget` reads.
 *
 * The recommendation and the candidate list have to agree or the button cannot
 * fire: `resolveMergeTarget` resolves `merge_target_name` ONLY against
 * `match_candidates`, by whole name. Writing one without the other is a
 * recommendation with no id behind it — which is precisely the "label with
 * nothing behind it" the merge route's own header records.
 */
function candidateFor(entry: RegisterEntry): Record<string, unknown> {
  return {
    kind: entry.kind,
    project_id: entry.kind === 'project' ? entry.id : null,
    project_name: entry.kind === 'project' ? entry.name : null,
    opportunity_id: entry.kind === 'opportunity' ? entry.id : null,
    opportunity_name: entry.kind === 'opportunity' ? entry.name : null,
    score: 0.8,
    match_reasons: ['decide_rescrub'],
    extracted_project_index: 0,
  }
}

/** Is this record already in the session's candidate list, by id? */
function alreadyCandidate(matchCandidates: unknown, entry: RegisterEntry): boolean {
  if (!Array.isArray(matchCandidates)) return false
  return matchCandidates.some((c) => {
    if (!c || typeof c !== 'object') return false
    const o = c as Record<string, unknown>
    return entry.kind === 'project' ? o.project_id === entry.id : o.opportunity_id === entry.id
  })
}

/**
 * Re-ask every pending EMAIL session where it belongs.
 *
 * ⚠ EMAIL ONLY, FOR THE REASON THE PRE-DECIDE PHASE IS. A meeting extraction has
 * attendees and referenced records, not a project and parties, and a meeting is
 * filed through its own reviewer and its own confirm route. Judging one with an
 * email-shaped question is what auto-dismissed two recorded calls before
 * `intake_kind='email'` was added there. A meeting row on /decide gets the
 * manual picker instead, which is the honest answer for it.
 */
export async function rescrubPendingSessions(
  opts: { limit?: number; budgetMs?: number; userId?: string } = {}
): Promise<RescrubProgress> {
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const supabase = createAdminClient()
  const progress: RescrubProgress = {
    examined: 0,
    placed: 0,
    unplaced: 0,
    unchanged: 0,
    failed: 0,
    changes: [],
  }

  const register = await loadRegister()
  if (register.length === 0) return progress
  /*
    ⚠ THE TYPE LEADS, IN SQUARE BRACKETS, so what follows it is unambiguously
    the name. It trailed in parentheses for exactly one live run, and several
    record names END in parentheses — "Whiskey (TX)",
    "Steelton — Cleveland-Cliffs (PA)" — so a trailing "(opportunity)" read as
    part of the name and came back as part of the answer.
  */
  const shown = register.map((e) => `[${e.kind}] ${e.name}`)

  const { data, error } = await supabase
    .from('email_intake_sessions')
    .select('id, label, raw_text, extraction_result, match_candidates, predecision')
    .eq('status', 'pending')
    .eq('intake_kind', 'email')
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (error) throw new Error(`Could not load the queue: ${error.message}`)

  for (const row of (data ?? []) as unknown as SessionRow[]) {
    if (Date.now() >= deadline) break
    progress.examined++
    try {
      const extraction = row.extraction_result ?? {}
      const { data: raw } = await callGemini<Partial<DecideRescrubAnswer>>({
        task: 'decide-rescrub',
        systemPrompt: DECIDE_RESCRUB_SYSTEM_PROMPT,
        userMessage: buildRescrubMessage({
          label: row.label ?? '(untitled)',
          summary: str(extraction.summary),
          suggestedRecord: str(extraction.suggested_record),
          register: shown,
          excerpt: (row.raw_text ?? '').slice(0, MAX_EXCERPT_CHARS),
        }),
        userId: opts.userId ?? SYSTEM_USER_ID,
        promptVersion: DECIDE_RESCRUB_PROMPT_VERSION,
        reasoning: wireReasoning(DECIDE_RESCRUB_REASONING),
      })

      const answer = typeof raw === 'object' && raw ? raw : null
      // ⚠ RESOLVED AGAINST THE REGISTER, NEVER TRUSTED — see resolveRescrubAnswer.
      const entry = resolveRescrubAnswer(register, answer)
      if (!entry) {
        progress.unplaced++
        continue
      }
      const confidence = Number(answer?.confidence)

      const pre = (row.predecision ?? {}) as Record<string, unknown>
      /*
        Already pointing at this record — nothing to say, and no write.

        ⚠ UNLESS IT IS NOT STAMPED, in which case the write still has to happen
        for the reason below: a row with no `prompt_version` is one the nightly
        pre-decide pass will re-judge from the OLD candidate list and may
        overwrite. Skipping it here because the recommendation already looks
        right is how a placement survives until the morning and no longer.
      */
      if (
        pre.disposition === 'merge' &&
        fold(String(pre.merge_target_name ?? '')) === entry.key &&
        typeof pre.prompt_version === 'string' &&
        alreadyCandidate(row.match_candidates, entry)
      ) {
        progress.unchanged++
        continue
      }

      const candidates = Array.isArray(row.match_candidates) ? [...row.match_candidates] : []
      if (!alreadyCandidate(candidates, entry)) candidates.unshift(candidateFor(entry))

      const reason = str(answer?.reason) ?? `Matched to ${entry.name} on a second pass.`
      const { error: writeErr } = await supabase
        .from('email_intake_sessions')
        .update({
          match_candidates: candidates as unknown as JsonIn,
          predecision: {
            ...pre,
            disposition: 'merge',
            merge_target_name: entry.name,
            confidence,
            reason,
            headline: `Re-checked against the whole portfolio: ${reason}`,
            decided_at: new Date().toISOString(),
            /*
              ⚠ `prompt_version` STAYS THE PRE-DECIDE PHASE'S, AND IS FILLED IN
              WHEN IT IS MISSING. That one column is what
              `predecidePendingSessions` selects on — `predecision is null OR
              prompt_version != current` — so it decides whether the nightly
              pass comes back and re-judges this row.

              Writing THIS pass's version into it would make the session
              permanently eligible, and the next pre-decide run would quietly
              undo every placement here. Leaving it ABSENT does the same thing
              for a session the pre-decide phase had not reached yet: null
              predecision means unjudged, and `{...pre}` of an empty object
              carries no version. Either way the morning run overwrites a
              recommendation a person may have been about to act on.

              So: keep the version the row had, and stamp the current one when
              it had none. The row genuinely IS judged now — by a later pass,
              against a bigger list — and the selector's own words are
              "undecided, or decided by a prompt that no longer exists", of
              which neither is true.
            */
            prompt_version: pre.prompt_version ?? INTAKE_PREDECIDE_PROMPT_VERSION,
            rescrubbed_at: new Date().toISOString(),
            rescrub_version: DECIDE_RESCRUB_PROMPT_VERSION,
          } as unknown as JsonIn,
        })
        .eq('id', row.id)
        // Only while it is still waiting. A session confirmed or dismissed by a
        // human between the read and the write must not be reopened by a
        // recommendation.
        .eq('status', 'pending')
      if (writeErr) throw new Error(writeErr.message)

      progress.placed++
      progress.changes.push({
        id: row.id,
        label: row.label ?? '(untitled)',
        record: entry.name,
        reason,
      })
    } catch (err) {
      console.error(
        `[decide/rescrub] ${row.id} failed:`,
        err instanceof Error ? err.message : String(err)
      )
      progress.failed++
    }
  }

  return progress
}
