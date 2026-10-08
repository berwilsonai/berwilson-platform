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
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { leadsDb } from '@/lib/leads/db'
import { decideWeight, daysUntil, meetingBoost } from '@/lib/decide/rank'
import {
  countMisfiledCompanyDocuments,
  findMisfiledCompanyDocuments,
} from '@/lib/documents/unfiled'
import { pendingProposalGroups } from '@/lib/economics/store'

export async function countDecideItems(): Promise<number> {
  const supabase = createAdminClient()
  try {
    const [intake, leads, review, documents, economics] = await Promise.all([
      supabase
        .from('email_intake_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      leadsDb()
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('status', ['new', 'reviewing'])
        // The page drops leads the assessor said to pass on. `.neq()` would
        // ALSO drop every unscored lead, because PostgREST treats NULL as not
        // matching — and an untriaged bid invitation is exactly the thing that
        // most needs deciding.
        .or('fit_recommendation.is.null,fit_recommendation.neq.pass'),
      supabase
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
      // ⚠ NOT a head:true count of its own. Unfiled documents are decided by a
      // matcher, not a WHERE clause — the question is "does this document have
      // a deal home", which no SQL predicate can answer. So this calls the same
      // pass the page renders. A second definition would drift, and then the
      // badge and the page report different numbers for one quantity (§12).
      countMisfiledCompanyDocuments(),
      // Economics figures the AI proposed and nobody has decided. Counted as
      // one item per DEAL, not per figure: forty figures out of one proposal
      // document are one sitting, and counting them individually would make
      // this badge read 40 for what is one decision.
      pendingProposalGroups().then((g) => g.length).catch(() => 0),
    ])
    return (intake.count ?? 0) + (leads.count ?? 0) + (review.count ?? 0) + documents + economics
  } catch {
    // The shell must render even if a count fails; a missing badge is a far
    // smaller problem than a missing sidebar.
    return 0
  }
}


export interface DecideSummary {
  total: number
  leads: number
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
  /** Deals with economics figures proposed and undecided. One per DEAL. */
  economics: number
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
    total: 0, leads: 0, intake: 0, meetings: 0, review: 0, documents: 0, economics: 0, top: [],
  }
  try {
    const [intake, leads, review, unfiledDocs, economicsGroups] = await Promise.all([
      supabase
        .from('email_intake_sessions')
        .select('id, label, predecision, fit_assessment, intake_kind, extraction_result')
        .eq('status', 'pending')
        .limit(200),
      leadsDb()
        .from('leads')
        .select('id, title, sender_company, bid_due_date, fit_score, fit_recommendation')
        .in('status', ['new', 'reviewing'])
        .or('fit_recommendation.is.null,fit_recommendation.neq.pass')
        .limit(200),
      supabase
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
      findMisfiledCompanyDocuments(),
      pendingProposalGroups().catch(() => []),
    ])

    const rows: Array<{
      line: string
      daysLeft: number | null
      verdict: string | null
      score: number | null
      boost?: number
    }> = []

    for (const raw of (leads.data ?? []) as Array<Record<string, unknown>>) {
      const days = daysUntil((raw.bid_due_date as string) ?? null, now)
      const when =
        days === null
          ? ''
          : days < 0
            ? ` — bid closed ${Math.abs(days)}d ago`
            : days === 0
              ? ' — bid due today'
              : ` — bid due in ${days}d`
      rows.push({
        line: `Inbound bid: ${String(raw.title ?? 'Untitled')}${raw.sender_company ? ` (${String(raw.sender_company)})` : ''}${when}`,
        daysLeft: days,
        verdict: (raw.fit_recommendation as string) ?? null,
        score: typeof raw.fit_score === 'number' ? raw.fit_score : null,
      })
    }

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
            `Meeting to file: ${s.label || 'Recorded meeting'}` +
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

    // One line per deal, naming the deal rather than the figures: the decision
    // needs the model beside it, so this points at the tab.
    for (const group of economicsGroups.slice(0, 5)) {
      rows.push({
        line: `Economics figures to confirm: ${group.count} read from ${group.recordName}'s documents`,
        daysLeft: null,
        verdict: null,
        score: null,
      })
    }

    rows.sort((a, b) => decideWeight(b) - decideWeight(a))

    const sessions = intake.data ?? []
    // Split, never double-counted: the two together must still equal what
    // countDecideItems() counts in one query, or the badge and the brief report
    // different sizes for one queue (§12 — one quantity, one definition).
    const meetingCount = sessions.filter((s) => s.intake_kind === 'meeting').length
    const intakeCount = sessions.length - meetingCount
    const leadCount = (leads.data ?? []).length
    const reviewCount = review.count ?? 0
    const documentCount = unfiledDocs.length
    const economicsCount = economicsGroups.length
    return {
      total: intakeCount + meetingCount + leadCount + reviewCount + documentCount + economicsCount,
      leads: leadCount,
      intake: intakeCount,
      meetings: meetingCount,
      review: reviewCount,
      documents: documentCount,
      economics: economicsCount,
      top: rows.slice(0, 5).map((r) => r.line),
    }
  } catch {
    // Same reasoning as the count: the brief must still be written.
    return empty
  }
}
