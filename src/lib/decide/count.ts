/**
 * How many items the Decide queue actually holds.
 *
 * The sidebar badge on Decide counted `review_queue` alone — it predates the
 * Decide page, having been the Review Queue badge — so it read 68 against a
 * page holding 238. A badge that under-reports its own destination by three
 * and a half times is worse than no badge: it sets an expectation the page
 * immediately contradicts.
 *
 * Kept beside the page's filters rather than inside it because the two ask
 * different questions of the same rows (a count versus the rows themselves),
 * and the only thing that must not drift is WHICH rows count.
 *
 * ⚠ INBOUND LEADS ARE NO LONGER ONE OF THEM (10-22). They were counted here and
 * in `summarizeDecideQueue` until Richard took them off the page entirely —
 * *"the decide section should be super clean with important tasks and current
 * business"* — and 9 of the queue's 17 rows that day were info@ sub-bid
 * invitations. Both counters, the brief's sentence and the digest's block came
 * out in the SAME commit, because this file is where a badge first came to
 * disagree with the page it points at: six readers share these two functions
 * (sidebar, dashboard KPI, daily brief, digest, Pepper, attention), and one
 * left behind would report a queue size nobody could reconcile with the screen.
 *
 * Leads have their own count now — `countLeadsNeedingWork` in
 * src/lib/leads/count.ts, feeding a badge on /leads — and it carries the
 * `closingSoon` figure that `decideWeight`'s deadline band used to provide here.
 */
import { createAdminClient } from '@/lib/supabase/admin'
// ⚠ `daysUntil` WENT WITH THE LEAD ROWS. It was imported here only to turn a
// bid date into "due in 3d" for the brief's prose, and nothing left in this
// queue carries a deadline (see the note on DecideFacts in DecideClient).
import { decideWeight, meetingBoost } from '@/lib/decide/rank'
import {
  countMisfiledCompanyDocuments,
  findMisfiledCompanyDocuments,
} from '@/lib/documents/unfiled'
import { countMisfiledRecordDocuments } from '@/lib/documents/misfiled'

/**
 * The two document lanes, cached — because this badge renders in the ROOT
 * LAYOUT on every page.
 *
 * ⚠ MEASURED 2026-10-20: `countDecideItems()` took 1,041ms, and adding the
 * wrong-deal lane it was missing would have taken it past 1.6s. That is a
 * second of latency on every navigation in the app, spent on a number in the
 * sidebar. The cost is not SQL — it is the two matcher passes, which run
 * `loadTargets()` and score every live document against every record, because
 * "does this document have a deal home" is a question no WHERE clause can
 * answer (see the header of unfiled.ts).
 *
 * So the passes stay exact and the BADGE remembers them for 60 seconds. Same
 * shape and same TTL as `listCategories` in src/lib/leads/categories.ts, and
 * the same reason for a TTL rather than a permanent cache: `next start` holds
 * one process for days (§12), so a permanent cache would mean filing a
 * document never changed the badge until the next deploy. The writers call
 * `invalidateDecideDocumentCounts()` so a tap is visible at once.
 *
 * ⚠ THE PAGE IS NEVER SERVED FROM HERE. /decide calls the passes directly, so
 * the rows a reader acts on are always live; this cache can only make the
 * BADGE up to a minute stale, which is the right thing to be imprecise about.
 */
let docCache: { unfiled: number; misfiled: number; at: number } | null = null
const DOC_TTL_MS = 60_000

export function invalidateDecideDocumentCounts(): void {
  docCache = null
}

async function documentCounts(): Promise<{ unfiled: number; misfiled: number }> {
  if (docCache && Date.now() - docCache.at < DOC_TTL_MS) return docCache
  const [unfiled, misfiled] = await Promise.all([
    countMisfiledCompanyDocuments(),
    countMisfiledRecordDocuments().catch(() => 0),
  ])
  docCache = { unfiled, misfiled, at: Date.now() }
  return docCache
}

export async function countDecideItems(): Promise<number> {
  const supabase = createAdminClient()
  try {
    const [intake, review, documents, fieldQuestions] = await Promise.all([
      // ⚠ NOT A head:true COUNT, AND THE REASON IS THE BUG THIS BADGE EXISTS TO
      // AVOID. Both the page (decide/page.tsx) and the brief
      // (summarizeDecideQueue below) skip a session whose predecision is
      // `dismiss` — the model has already judged it and the row is not a
      // decision anybody has to make. The badge did not, so it counted rows its
      // own destination refuses to render: measured 2026-10-20, 125 of 247
      // decided sessions carried that verdict, and the badge over-reported the
      // page it points at by roughly double for weeks. §12 — one quantity, one
      // definition, and the definition lives with the rows.
      //
      // `predecision` is jsonb, so this cannot be a SQL predicate the count
      // would honour (a `->>` filter inside a head count is exactly the kind of
      // PostgREST silent-drop §12 warns about). Reading the column and counting
      // in JS is the honest version, and it is one narrow query: the page
      // already fetches these same rows with their full payload.
      supabase
        .from('email_intake_sessions')
        .select('id, predecision')
        .eq('status', 'pending')
        .limit(1000),
      supabase
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
      // ⚠ NOT head:true counts of their own. Both document lanes are decided
      // by a matcher, not a WHERE clause — "does this document have a deal
      // home" and "does its name point at a DIFFERENT deal" are questions no
      // SQL predicate can answer. So these call the same passes the page
      // renders, through the 60s cache above. A second definition would drift,
      // and then the badge and the page report different numbers for one
      // quantity (§12).
      //
      // ⚠ THE WRONG-DEAL LANE WAS SIMPLY MISSING HERE. /decide renders it as
      // its own `misfiled` chip and the brief has never counted it either, so
      // this badge has always been able to read lower than the page it points
      // at — the mirror of the `dismiss` bug above, in the same number. Small
      // today (2 rows) and 38 as recently as 10-14.
      documentCounts(),
      // Guarded fields Pepper is asking about rather than overwriting. Counted
      // by `summarizeDecideQueue` and rendered by the page; this badge left
      // them out, which is the third definition of one quantity.
      supabase
        .from('field_update_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])
    const intakeCount = (intake.data ?? []).filter(
      (s) => (s.predecision as { disposition?: string } | null)?.disposition !== 'dismiss'
    ).length
    return (
      intakeCount +
      (review.count ?? 0) +
      documents.unfiled +
      documents.misfiled +
      (fieldQuestions.count ?? 0)
    )
  } catch {
    // The shell must render even if a count fails; a missing badge is a far
    // smaller problem than a missing sidebar.
    return 0
  }
}


export interface DecideSummary {
  total: number
  intake: number
  /**
   * Recorded meetings staged and not yet filed onto a deal.
   *
   * Counted apart from `intake` because the sentence that reported them
   * together called them "staged from correspondence", and a call one of the
   * executives personally sat in is not correspondence.
   */
  meetings: number
  review: number
  /** Company documents that belong on a deal, or are not documents at all. */
  documents: number
  /**
   * Documents already ON a deal whose own name points at a DIFFERENT one.
   *
   * ⚠ A SEPARATE FIELD, NEVER FOLDED INTO `documents`. They are two
   * quantities: one is a gap (no deal at all), the other is an answer already
   * being given about the wrong record, and the correction is different —
   * see the header of misfiled.ts. /decide has always rendered them as its own
   * chip; this and `countDecideItems` were the two readers that left them out.
   */
  misfiled: number
  /**
   * Guarded fields Pepper is asking about rather than overwriting.
   *
   * ⚠ COUNTED HERE SO THE QUEUE'S OWN TOTAL INCLUDES THEM. The chip row and
   * the count map on /decide both derive from the kind registry, so the screen
   * picked this lane up for free — but `total` is summed by name, and a lane
   * missing from it makes the badge and the morning note disagree with the
   * screen about how big the queue is (§12).
   */
  fieldQuestions: number
  /** The most consequential items, already ranked, as prose lines. */
  top: string[]
}

/**
 * What the Decide queue holds, for a reader who is not looking at it.
 *
 * ⚠ Nothing anywhere told anyone this queue existed. Asked on 2026-09-23 why
 * 1,268 scored leads had produced zero records, Richard's own answer was that
 * he had not been looking — and he was right to say so, because the platform
 * announced individual arrivals once, via a latch that deliberately never
 * repeats, and then never mentioned the accumulated pile again. The weekly
 * brief is the one thing he reliably reads.
 *
 * Shares `countDecideItems`' filters and the page's `decideWeight`, so the
 * brief cannot claim a different queue or a different top item from the screen
 * it sends him to.
 */
export async function summarizeDecideQueue(now = Date.now()): Promise<DecideSummary> {
  const supabase = createAdminClient()
  const empty: DecideSummary = {
    total: 0, intake: 0, meetings: 0, review: 0, documents: 0, misfiled: 0,
    fieldQuestions: 0, top: [],
  }
  try {
    const [intake, review, unfiledDocs, misfiledCount, fieldQuestions] =
      await Promise.all([
      supabase
        .from('email_intake_sessions')
        .select('id, label, predecision, fit_assessment, intake_kind, extraction_result, source_title')
        .eq('status', 'pending')
        .limit(200),
      supabase
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
      findMisfiledCompanyDocuments(),
      countMisfiledRecordDocuments().catch(() => 0),
      // Head-only count: the queue's size, not its contents. The page reads the
      // rows themselves.
      supabase
        .from('field_update_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])

    const rows: Array<{
      line: string
      daysLeft: number | null
      verdict: string | null
      score: number | null
      boost?: number
    }> = []

    for (const s of intake.data ?? []) {
      const pre = (s.predecision ?? {}) as Record<string, unknown>
      if (pre.disposition === 'dismiss') continue

      // ⚠ A RECORDED MEETING GETS ITS OWN SENTENCE. Reading as "Staged
      // correspondence" made a call Richard had personally sat in look like one
      // more scraped email thread — and with 115 email packages pending, the
      // ranking never surfaced it at all. The Tensor call of 2026-10-07 was
      // imported, summarized, and never mentioned to anybody.
      if (s.intake_kind === 'meeting') {
        const extraction = (s.extraction_result ?? {}) as Record<string, unknown>
        const when = typeof extraction.meeting_date === 'string' ? extraction.meeting_date : null
        const tasks = Array.isArray(extraction.tasks) ? extraction.tasks.length : 0
        rows.push({
          line:
            // The invitation title, for the same reason /decide leads with it:
            // it is the name on his own calendar. The model's rewrite is not
            // repeated here — the note has one line and the date is worth more.
            `Meeting to file: ${s.source_title?.trim() || s.label || 'Recorded meeting'}` +
            (when ? ` (${when})` : '') +
            (tasks > 0 ? ` — ${tasks} follow-up${tasks === 1 ? '' : 's'} waiting on a record` : ''),
          daysLeft: null,
          verdict: null,
          score: null,
          // Freshest first among the meetings — see meetingBoost.
          boost: meetingBoost(when, now),
        })
        continue
      }

      const fit = (s.fit_assessment ?? {}) as Record<string, unknown>
      const score = Number(fit.fit_score)
      const headline = typeof pre.headline === 'string' && pre.headline ? ` — ${pre.headline}` : ''
      rows.push({
        line: `Staged correspondence: ${s.label || 'Untitled research package'}${headline}`,
        daysLeft: null,
        verdict: (pre.disposition as string) ?? null,
        score: Number.isFinite(score) ? score : null,
      })
    }

    // Ranked by retrieval footprint: the document polluting the most answers
    // is the one worth reading about first. No deadline and no verdict, so it
    // sorts below anything with a date — correctly, since nothing expires.
    for (const doc of unfiledDocs.slice(0, 5)) {
      rows.push({
        line: `Unfiled document: ${doc.fileName}${
          doc.target ? ` — probably ${doc.target.name}` : ''
        }${doc.chunks > 0 ? ` (${doc.chunks} passages answering as company knowledge)` : ''}`,
        daysLeft: null,
        verdict: null,
        score: null,
      })
    }

    rows.sort((a, b) => decideWeight(b) - decideWeight(a))

    // ⚠ FILTERED THE SAME WAY THE `rows` LOOP ABOVE FILTERS. That loop skips a
    // `dismiss` predecision when building the prose lines; counting the
    // unfiltered array made the brief's total larger than the list it was the
    // total of, and larger than the page. One definition, applied once, here.
    const sessions = (intake.data ?? []).filter(
      (s) => (s.predecision as { disposition?: string } | null)?.disposition !== 'dismiss'
    )
    // Split, never double-counted: the two together must still equal what
    // countDecideItems() counts in one query, or the badge and the brief report
    // different sizes for one queue (§12 — one quantity, one definition).
    const meetingCount = sessions.filter((s) => s.intake_kind === 'meeting').length
    const intakeCount = sessions.length - meetingCount
    const reviewCount = review.count ?? 0
    const documentCount = unfiledDocs.length
    const misfiledDocCount = misfiledCount
    const fieldQuestionCount = fieldQuestions.count ?? 0
    return {
      total:
        intakeCount +
        meetingCount +
        reviewCount +
        documentCount +
        misfiledDocCount +
        fieldQuestionCount,
      intake: intakeCount,
      meetings: meetingCount,
      review: reviewCount,
      documents: documentCount,
      misfiled: misfiledDocCount,
      fieldQuestions: fieldQuestionCount,
      top: rows.slice(0, 5).map((r) => r.line),
    }
  } catch {
    // Same reasoning as the count: the brief must still be written.
    return empty
  }
}
