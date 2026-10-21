/**
 * File the meetings nobody filed — run unconditionally, every sweep.
 *
 * ⚠ THIS IS §12'S REAPER RULE, AND THE BUG IT EXISTS FOR WAS FOUND BY ASKING
 * RICHARD'S QUESTION "is that because I only dismissed them?". The answer was
 * yes, for one record type: dismissing a staged EMAIL session loses nothing
 * (the threads stay summarized, indexed and routable), but dismissing a staged
 * MEETING left the `meetings` row `scope='unfiled'`, `status='draft'`, on no
 * deal, with its follow-up tasks never created — and `/decide` reads
 * `email_intake_sessions`, not `meetings`, so once the session was gone nothing
 * queued the meeting ever again. Nine real calls, the oldest from August, were
 * sitting invisible. §12: *a cleanup that is a side effect of having work to do
 * never reaches the rows with no work. A polymorphic pointer needs its own
 * reaper, run unconditionally.*
 *
 * WHAT IT FILES ON, AND WHAT IT REFUSES. Only a `target` from
 * `resolveMeetingTarget` — a learned title, an exact record name, or an alias a
 * human asserted. Never a `suggestion`: §12 is explicit that an automatic bar
 * and a pre-tick bar cannot share one threshold, and a transcript filed onto
 * the wrong deal answers questions about that deal until somebody notices. Of
 * the nine, this files the ones whose organiser title names a record and leaves
 * the rest alone, by design — measured, the other signals do not discriminate:
 *
 *   - the MODEL's title names a topic, not a record ("Richard White
 *     Introduction & Strategic Vision"), and resolved nothing for all nine;
 *   - the ATTENDEES resolve to 8–11 records each, because Richard and Eric are
 *     `project_players` on nearly everything — the §12 shared-word failure
 *     wearing a different hat;
 *   - seven of sixteen organiser titles are ISO TIMESTAMPS
 *     (`2026-10-19T12:34:18Z`), because an iPhone memo is named by its clock.
 *     A timestamp names no deal and never will.
 *
 * So this closes the gap that is closeable and `listUnfiledMeetings` surfaces
 * the remainder, which is a decision only a person can make. Guessing is the
 * documented catastrophe: 9 of 9 records a fuzzy gate would have created on
 * 10-19 were wrong.
 *
 * Idempotent: a meeting that already carries a record is refused by
 * `attachMeetingToRecord` itself, so a second run reports nothing (§12 — pair
 * every fill-not-overwrite pass with a script that calls it twice).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { attachMeetingToRecord } from '@/lib/meetings/record'
import { resolveMeetingTarget } from '@/lib/meetings/file-notes'

export interface UnfiledMeeting {
  id: string
  /** The organiser's title where there is one — the string a reader recognises. */
  title: string
  date: string | null
  /** Why it is still unfiled, in a sentence a reader can act on. */
  reason: string
  /**
   * The record the MODEL's title points at, if any.
   *
   * Never filed on (see FILING_TITLE) and carried so the reader's tap has a
   * default. A suggestion with a name beside it is a decision; a bare list of
   * nine calls is an investigation.
   */
  suggestion: { kind: 'project' | 'opportunity'; id: string; name: string } | null
}

export interface ReconcileUnfiledResult {
  considered: number
  filed: number
  /** Still unfiled, with the reason and a suggested record where one exists. */
  remaining: UnfiledMeeting[]
}

/**
 * Candidate name strings from ONE title — the whole string, then its segments.
 *
 * Split on the separators an organiser actually types between names —
 * `Ber Wilson/Tensor Discuss Uintah Basin`, `Ber Wilson / Zenthium`,
 * `Steelton & Riverdale Site Reviews`. A segment under three characters is
 * dropped by the resolver anyway; dropped here too so the list stays readable
 * in a log.
 *
 * An ISO timestamp yields NOTHING rather than failing downstream, so the "why"
 * a reader is given stays honest: a memo named by its clock will never resolve,
 * and the useful advice is to rename it, not to wait.
 */
export function meetingNameCandidates(title: string | null | undefined): string[] {
  const v = (title ?? '').trim()
  if (!v || isTimestampTitle(v)) return []
  const out = [v]
  for (const seg of v.split(/\s*[—–|/:·]\s*|\s+&\s+|\s*,\s*/)) {
    const s = seg.trim()
    if (s.length >= 3 && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * ⚠ THE ORGANISER'S TITLE FILES; THE MODEL'S TITLE ONLY SUGGESTS. This is the
 * line, and the first version of this pass got it wrong — worth recording,
 * because the wrong version looked better on the numbers.
 *
 * Both titles were fed to the resolver as one candidate list, which filed 4 of
 * 9 meetings. Reading WHICH candidate matched showed two of the four were
 * decided by the model's rewrite: a call whose organiser title was the ISO
 * timestamp `2026-09-23T15:31:08Z` filed onto **Elite Solutions** because the
 * model had titled it "…Discussion with Tensor IQ/Avant" and `Avant` is an
 * alias; and a "Ber Wilson/Rebecca/Merlin visit" filed onto **Steelton**
 * because the model's title said "Steelton Acquisition Discussion".
 *
 * Both are plausible and neither is a fact. §12 is the argument: an alias is
 * strong because *a human asserted it*, and a title is strong because *a human
 * typed it about their own meeting* — a model's summary of what got discussed
 * is neither, and 9 of 10 recorded calls here name between two and eight deals,
 * so the deal a summary leads with is routinely not the deal the call was for.
 * A transcript filed onto the wrong record answers questions about that record
 * until somebody notices; one left unfiled is still fully searchable. The
 * asymmetry decides it.
 *
 * So the model's title is resolved too, and its answer is carried as a
 * SUGGESTION for the reader — which is what makes the remainder one tap rather
 * than an investigation.
 */
export const FILING_TITLE = 'organiser' as const

/** `2026-10-19T12:34:18Z`, with or without the Z — an iPhone memo's own name. */
export function isTimestampTitle(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T_ ]\d{2}[:_]\d{2}[:_]\d{2}Z?$/.test(value.trim())
}

/**
 * Resolve and file every meeting sitting on no record.
 *
 * `limit` is a safety rail rather than a page: the index behind this query is
 * partial on `scope = 'unfiled'`, so the set is small by construction and a
 * backlog that ever grew past it would itself be the thing to report.
 */
export async function reconcileUnfiledMeetings(
  opts: { limit?: number; dryRun?: boolean } = {}
): Promise<ReconcileUnfiledResult> {
  const supabase = createAdminClient()
  const result: ReconcileUnfiledResult = { considered: 0, filed: 0, remaining: [] }

  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, source_title, meeting_date')
    .eq('scope', 'unfiled')
    // A declined meeting is a decision already taken, not a row awaiting one.
    .is('filing_declined_at', null)
    .order('meeting_date', { ascending: false })
    .limit(opts.limit ?? 200)
  if (error) {
    console.error('[meetings/reconcile] could not read unfiled meetings:', error.message)
    return result
  }

  for (const m of data ?? []) {
    result.considered++
    const organiser = (m.source_title ?? '').trim()
    const modelTitle = (m.title ?? '').trim()
    // The organiser's string is what a reader recognises — §13 complained that
    // the model's rewrite made a Zenthium call unrecognisable in every list.
    const label = organiser || modelTitle || '(untitled)'

    // ── the filing bar: the organiser's title, and nothing else ────────────
    const filingCandidates = meetingNameCandidates(organiser)
    const filing = filingCandidates.length
      ? await resolveMeetingTarget(filingCandidates).catch((err) => {
          console.error(`[meetings/reconcile] ${m.id} resolve failed:`, err)
          return null
        })
      : null

    if (filing?.target && !opts.dryRun) {
      // No recap passed: this pass files an EXISTING row onto a record, and the
      // title, date, summary and attendees on it are already the best the
      // platform has. Handing a recap here would let a reconciliation overwrite
      // a human's edits (§12 — filling a blank and overwriting a value are
      // different acts, and only one is safe to automate).
      const moved = await attachMeetingToRecord(supabase, m.id, {
        kind: filing.target.kind,
        id: filing.target.id,
      })
      if (moved.moved) {
        result.filed++
        console.log(
          `[meetings/reconcile] filed "${label}" onto ${filing.target.kind} ` +
            `${filing.target.name} (via ${filing.via})`
        )
        continue
      }
      result.remaining.push({
        id: m.id, title: label, date: m.meeting_date,
        reason: moved.reason ?? 'could not be moved', suggestion: null,
      })
      continue
    }
    if (filing?.target) {
      result.filed++
      continue
    }

    // ── the suggestion: the model's title, for the reader's tap ────────────
    const hinted = await resolveMeetingTarget(meetingNameCandidates(modelTitle)).catch(() => null)
    const suggestion = hinted?.target ?? hinted?.suggestion ?? null

    result.remaining.push({
      id: m.id,
      title: label,
      date: m.meeting_date,
      reason: isTimestampTitle(organiser)
        ? 'the recording is named by its clock — rename it after the deal and the next one files itself'
        : (filing?.ambiguous ??
           (filingCandidates.length === 0
             ? 'nothing names the record: no organiser title to file by'
             : 'its own title names no record — add the phrase you call this deal to that record\u2019s aliases')),
      suggestion: suggestion
        ? { kind: suggestion.kind, id: suggestion.id, name: suggestion.name }
        : null,
    })
  }

  return result
}

/**
 * Every meeting on no record, for a reader.
 *
 * ⚠ THE WHOLE REASON THE NINE WERE INVISIBLE IS THAT NOTHING ANSWERED THIS
 * QUESTION. §12: a surface hidden because it is empty is hidden exactly when
 * somebody needs to fill it — and this one was not even hidden, it did not
 * exist. Shown with the organiser's title where there is one, because that is
 * the string Richard would recognise; the model's rewrite is what made a
 * Zenthium call unrecognisable in every list.
 */
export async function listUnfiledMeetings(limit = 50): Promise<
  Array<{
    id: string
    title: string
    sourceTitle: string | null
    date: string | null
    attendeeCount: number
    hasTranscript: boolean
  }>
> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, source_title, meeting_date, attendees, transcript')
    .eq('scope', 'unfiled')
    // A declined meeting is a decision already taken, not a row awaiting one.
    .is('filing_declined_at', null)
    .order('meeting_date', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[meetings/reconcile] could not list unfiled meetings:', error.message)
    return []
  }
  return (data ?? []).map((m) => ({
    id: m.id,
    title: (m.title ?? '').trim() || '(untitled)',
    sourceTitle: (m.source_title ?? '').trim() || null,
    date: m.meeting_date,
    attendeeCount: Array.isArray(m.attendees) ? m.attendees.length : 0,
    hasTranscript: Boolean((m.transcript ?? '').trim()),
  }))
}
