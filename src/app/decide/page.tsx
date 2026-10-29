import { PageHeader } from '@/components/ui/page-header'
import { Gavel, Info } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import DecideClient, { type DecideItem } from '@/components/decide/DecideClient'
import { reviewReasonLabel } from '@/lib/utils/review'
import { enumLabel, ACTIVITY_TABLE_LABELS } from '@/lib/utils/constants'
import { buildConfirmBody } from '@/lib/email-ingestion/defaults'
import { resolveSessionTaskTarget, readExtractionTasks } from '@/lib/email-ingestion/task-target'
import { parseStagedAttachments } from '@/lib/email-ingestion/attachments'
import { findMisfiledCompanyDocuments, findUnparentedDocuments } from '@/lib/documents/unfiled'
import { findMisfiledRecordDocuments } from '@/lib/documents/misfiled'
import { readOpenProposals } from '@/lib/provenance/report'
import { asDecideSort } from '@/lib/decide/rank'
import { loadTargets } from '@/lib/email-sweep/route-phase'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import type { PickableRecord } from '@/components/shared/RecordPicker'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'

export const metadata = { title: 'Decide — Ber Wilson Intelligence' }

/**
 * One place for everything waiting on a decision.
 *
 * Before this, five surfaces each held part of the answer to "what needs me" —
 * /intake, /leads, /review, /tasks and the dashboard rail — for a company of
 * two people. Each was locally reasonable; together they meant no single screen
 * could tell you whether you were done, so nothing ever felt finished and the
 * intake queue reached 104 items with the oldest six weeks old.
 *
 * This does NOT replace those screens: each decision still opens its own review
 * UI, which is where the detail and the confirm step live. What it replaces is
 * the need to visit all of them to find out if there is anything to do.
 *
 * Deliberately excludes open tasks. A task is work you have already decided to
 * do; mixing it in here would turn a decision list back into a to-do list.
 */
/**
 * Where to go to see a proposed field in context.
 *
 * ⚠ ONLY TABLES WITH A PAGE, AND A FALLBACK THAT IS HONEST. A milestone is a
 * child rendered inside a tab, with no route of its
 * own — sending the reader to a URL assembled from the table name would be a
 * second routing table drifting beside the real one (§12). Those rows point at
 * the queue itself, which is where the question is answerable anyway.
 */
function recordHref(table: string, recordId: string): string {
  if (table === 'projects') return `/projects/${recordId}`
  if (table === 'opportunities') return `/opportunities/${recordId}`
  if (table === 'parties') return `/contacts/${recordId}`
  return '/decide'
}

/**
 * The queue.
 *
 * ⚠ THE VIEW IS SEEDED FROM THE URL AND SYNCED BACK WITHOUT A ROUND TRIP. The
 * sort, the kind chip and the search all live in the address bar so a view can
 * be linked — §12: a filter kept only in component state is not a view. But
 * this page is expensive (three corpus-wide document passes plus a portfolio
 * match per staged session), so `DecideClient` writes the URL with
 * `history.replaceState` rather than `router.replace`, exactly as `LeadsClient`
 * does and for the documented reason: the latter re-runs this whole server
 * component on every chip press.
 */
export default async function DecidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const params = await searchParams
  const one = (k: string): string | null => {
    const v = params[k]
    return typeof v === 'string' ? v : null
  }
  // Narrowed here rather than in the browser: an unknown ?sort= must fall back
  // to the default on the FIRST paint, or the list reorders after hydration.
  const initialSort = asDecideSort(one('sort'))
  const initialKind = one('kind')
  const initialQuery = one('q') ?? ''

  const supabase = createAdminClient()

  const [
    { data: sessions },
    { data: reviewRows },
    unfiledDocs,
    unparented,
    misfiledDocs,
    fieldQuestions,
  ] = await Promise.all([
    supabase
      .from('email_intake_sessions')
      .select(
        // ⚠ `match_candidates` IS LOAD-BEARING AND WAS MISSING. It is what
        // `resolveSessionTaskTarget` resolves an email session's deal against
        // (via resolveMergeTarget), so without it every "Task on ⟨deal⟩" offer
        // was silently refused — see the header of task-target.ts.
        'id, label, status, updated_at, predecision, match_candidates, fit_assessment, intake_kind, extraction_result, party_matches, staged_attachments, source_title'
      )
      .eq('status', 'pending')
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('review_queue')
      .select('id, source_table, reason, confidence, created_at, ai_explanation, project:projects(name)')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    // Company documents that belong on a deal, or are not documents at all.
    // The same pass backs the knowledge-base list on /company, so the queue and
    // that page can never disagree about what is waiting (§12).
    findMisfiledCompanyDocuments(),
    findUnparentedDocuments(),
    // Documents already on a deal, whose own name points at a DIFFERENT deal.
    // The other half of the same question — see the header of misfiled.ts.
    findMisfiledRecordDocuments().catch(() => []),
    readOpenProposals(100),
  ])

  /*
    Every record a row can be filed onto BY HAND.

    ⚠ `loadTargets()`, NOT A QUERY OF ITS OWN. It is the list the mail router,
    `matchDocument` and /documents/unfiled all match against, so a deal that can
    be proposed can also be chosen — two lists would be two answers to "what
    records are there", and then the picker lacks the one the matcher names
    (§12).

    ⚠ AND IT IS FILTERED FOR THE READER. A confidential project leaves every
    cross-portfolio surface (§8), and a picker is one: offering its name here
    would leak the project's existence to anybody who can open this page, which
    is containment failing before access is even asked about. Zero projects are
    confidential today — which is exactly when a filter is cheap to add and
    impossible to remember later.
  */
  const [rawTargets, hiddenProjects] = await Promise.all([
    loadTargets().catch(() => []),
    viewerHiddenProjectIds(),
  ])
  const records: PickableRecord[] = rawTargets
    .flatMap((t) =>
      // `flatMap` rather than `.filter()` with a predicate: narrowing a union
      // through a guard does not survive into a subsequent `.map`.
      // A lead is excluded because nothing here can file onto one — `refileDocument`
      // has no arm for it and the merge route's tables name only these two.
      (t.kind === 'project' || t.kind === 'opportunity') &&
      !(t.kind === 'project' && hiddenProjects.has(t.id))
        ? [{ kind: t.kind, id: t.id, name: t.name }]
        : []
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  const items: DecideItem[] = []

  /**
   * WHICH ROWS CAN OFFER "Task on ⟨deal⟩", resolved once for the whole page.
   *
   * ⚠ ONLY FOR SESSIONS THAT ACTUALLY HOLD FOLLOW-UPS. `resolveSessionTaskTarget`
   * reaches the portfolio matchers, so asking it about a session with no tasks
   * is a lookup whose answer could never be used — and a button offered on a
   * row with nothing behind it is the DINO_LEAD_EMAIL failure again, a live
   * control that 400s on press.
   *
   * ⚠ AND IT IS COMPUTED SERVER-SIDE LIKE EVERY OTHER `accept`. The browser is
   * never handed enough of the portfolio to choose a record, and a filing
   * decision that guessed would be indistinguishable from one that knew.
   */
  const taskOffers = new Map<string, { name: string; count: number }>()
  /*
    How many follow-ups each session holds, WHETHER OR NOT a deal resolves.

    ⚠ THE COUNT AND THE OFFER ARE TWO FACTS AND THEY WERE ONE. `taskOffers` is
    only filled where `resolveSessionTaskTarget` names a record, which is right
    for a button that files by itself — and it meant a session with four
    follow-ups and an unresolvable title had no way to say so. A human choosing
    the deal needs the count to know the choice is worth making, so the count is
    kept separately and the offer stays as strict as it was.
  */
  const taskCounts = new Map<string, number>()
  await Promise.all(
    (sessions ?? []).map(async (s) => {
      if (readPredecision(s.predecision)?.disposition === 'dismiss') return
      const count = readExtractionTasks(s.extraction_result).length
      if (count === 0) return
      taskCounts.set(s.id, count)
      const target = await resolveSessionTaskTarget(s).catch(() => null)
      if (!target?.ok) return
      taskOffers.set(s.id, { name: target.name, count: target.tasks.length })
    })
  )

  /*
    ⚠ INBOUND LEADS USED TO BE RENDERED HERE AND ARE NOT ANY MORE (10-22).
    Richard: *"I want to keep info@berwilson leads separate from real active
    leads and tasks derived from Eric's and my email... The decide section
    should be super clean with important tasks and current business."*

    Measured that day, the queue held 17 rows and NINE were info@ sub-bid
    invitations — roofing on a pharmacy remodel, fences on a UDOT box culvert,
    earthwork at Saratoga Corners — ranked above one staged thread and seven
    document questions about live deals. 53% of a decision queue was somebody
    else's plan room.

    ⚠ THE CUT IS `pipeline='lead'`, NOT THE MAILBOX. Eight info@ threads are
    classified `deal` and four are correctly filed on real records (the West
    Wendover master plan, the Myton Rail / Duchesne County review request), so
    excluding the mailbox would have buried live business. The triage already
    makes the right cut; this page simply stops reading one side of it.

    ⚠ AND THE DEADLINE HAD TO GO SOMEWHERE. A bid date was the only hard
    deadline in this queue — `decideWeight` still ranks on `deadline` and the
    header still counts "closing within a week", both now permanently zero
    here — so /leads gained a sidebar badge carrying `closingSoon` in the same
    change (src/lib/leads/count.ts). Deleting the rows without that would have
    traded a cluttered screen for a missed bid: two of the nine closed that day.

    Nothing about the RECORDS changed, because nothing needed to. Measured
    10-22: 0 of 1,900 lead threads link to a project or opportunity, 0
    commitments come off one, and no path under src/lib/leads touches `tasks`.
    The 10-21 router fix (§12 — a corpus with its own triage must not be
    guessed into the other one's records) already holds that line.
  */

  // --- Staged correspondence, carrying Ber AI's recommendation --------------
  for (const s of sessions ?? []) {
    const pre = readPredecision(s.predecision)
    if (pre?.disposition === 'dismiss') continue // auto-handled or low value

    // ⚠ A MEETING IS NOT A PIECE OF CORRESPONDENCE, AND THIS ROW TREATED IT AS
    // ONE. `intake_kind` was already selected here and never read, so all five
    // staged Meet transcripts rendered as "Staged correspondence", linked to
    // /email-ingestion/<id> — the EMAIL reviewer — and were handed to
    // buildConfirmBody, which reads an EmailIntakeExtraction out of a meeting
    // extraction that has no such shape. A meeting's reviewer is
    // /intake/meeting/<id> and its confirm route is a different one entirely.
    //
    // It also gets the boost: a call from yesterday has no deadline to rank on
    // and sank beneath 115 older email packages. See MEETING_BOOST.
    if (s.intake_kind === 'meeting') {
      const extraction = (s.extraction_result ?? {}) as Record<string, unknown>
      const when = typeof extraction.meeting_date === 'string' ? extraction.meeting_date : null
      const attendees = Array.isArray(extraction.attendees) ? extraction.attendees.length : 0
      const tasks = Array.isArray(extraction.tasks) ? extraction.tasks.length : 0
      // ⚠ THE INVITATION TITLE LEADS, because it is the one Richard will
      // recognise from his own calendar — and because the model's rewrite can
      // be actively misleading: the call titled "Ber Wilson / Zenthium" came
      // back as "Steelton & Riverdale Site Reviews & Power Capacity Analysis".
      // The rewrite is still shown, in the subtitle, where it earns its place
      // by saying what the call turned out to be about.
      const invitation = s.source_title?.trim() || null
      const modelTitle = s.label?.trim() || null
      items.push({
        id: s.id,
        kind: 'intake',
        title: invitation || modelTitle || 'Recorded meeting',
        // Says what confirming it will DO, which is the decision being asked.
        subtitle: [
          when,
          invitation && modelTitle && modelTitle !== invitation ? `“${modelTitle}”` : null,
          attendees > 0 ? `${attendees} attendee${attendees === 1 ? '' : 's'}` : null,
          tasks > 0 ? `${tasks} follow-up${tasks === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        href: `/intake/meeting/${s.id}`,
        verdict: null,
        score: null,
        // The meeting's own summary, not the email predecide's headline — it is
        // the richer sentence and it is about the right thing.
        note: typeof extraction.summary === 'string' ? extraction.summary : null,
        deadline: null,
        // The DATE, not a boost computed here: the client already captures one
        // clock reading at mount, and reading Date.now() in a server component
        // is the react-hooks/purity misfire §9 records. See meetingBoost.
        occurredAt: when,
        // The STAGING, not the call — see DecideItem.arrivedAt. A call from
        // last Tuesday staged this morning is new to the reader this morning.
        arrivedAt: s.updated_at,
        // Never accepted from the list. Filing a meeting is choosing which deal
        // it belongs to, which is a judgement with a screen of its own.
        accept: null,
        // ⚠ BUT ITS FOLLOW-UPS CAN BE TAKEN WITHOUT FILING THE CALL (10-22).
        // These two are different decisions and conflating them is why a call
        // with three dated next steps sat in the queue for weeks: filing asks
        // "which deal does this conversation belong to", which needs the
        // transcript, while "put those three follow-ups on Steelton's board" is
        // answerable from the row. Offered only where the ORGANISER's own title
        // resolves a deal — see task-target.ts.
        altAccept: taskOffers.has(s.id)
          ? { action: 'task' as const, name: taskOffers.get(s.id)!.name, count: taskOffers.get(s.id)!.count }
          : null,
        // What the picker can offer when the title resolves nothing — which is
        // the NORMAL case for a call, since `Call with <person>` names nobody's
        // deal by design. Filing the call itself still needs its own screen.
        taskCount: taskCounts.get(s.id) ?? 0,
        /*
          What the picker may do once a person names the deal.

          ⚠ FILING THE CALL ITSELF IS NOT HERE, and the omission is the point.
          A meeting's confirm route wants a whole body — the meeting's own
          metadata, a target per deal it covered, a decision per attendee and
          per follow-up — built by the review screen. Assembling a second,
          thinner version of it from this list would be a sibling-module fork
          of the one thing that screen does (§12), and the difference is not
          cosmetic: the thin version would silently create no attendees and no
          minutes. Its follow-ups, though, need none of that.
        */
        pickActions: (taskCounts.get(s.id) ?? 0) > 0 ? ['task'] : [],
      })
      continue
    }

    const fit = (s.fit_assessment ?? {}) as Record<string, unknown>
    const score = Number(fit.fit_score)
    // Derived here rather than in the browser: the draft is built from the full
    // extraction, which has no business being shipped to a page that shows one
    // line per row. Only the verdict travels.
    const draft =
      pre?.disposition === 'create'
        ? buildConfirmBody({
            sessionId: s.id,
            extraction: s.extraction_result as unknown as EmailIntakeExtraction,
            partyMatches: (s.party_matches ?? []) as unknown as PartyMatch[],
            stagedAttachments: parseStagedAttachments(s.staged_attachments),
          })
        : null
    items.push({
      id: s.id,
      kind: 'intake',
      title: s.label || 'Untitled research package',
      // ⚠ "Merge into X" WAS THE DATABASE'S WORD FOR IT. Nothing is merged — the
      // conversation joins a record that already exists and nothing is
      // overwritten. The button says the same thing now (see ACCEPT_COPY).
      subtitle: pre?.merge_target_name ? `Files onto ${pre.merge_target_name}` : null,
      href: `/email-ingestion/${s.id}`,
      verdict: pre?.disposition ?? null,
      score: Number.isFinite(score) ? score : null,
      arrivedAt: s.updated_at,
      note: pre?.headline ?? pre?.reason ?? null,
      confidence: pre?.confidence ?? null,
      deadline: null,
      accept:
        pre?.disposition === 'merge'
          ? 'merge'
          : draft?.ready
            ? draft.body.record_kind
            : null,
      acceptName: draft?.recordName ?? pre?.merge_target_name ?? null,
      // The second answer on a correspondence row: take the follow-ups and
      // leave the conversation staged. Same resolver as `merge` above, so the
      // two buttons can never name different deals (task-target.ts).
      altAccept: taskOffers.has(s.id)
        ? { action: 'task' as const, name: taskOffers.get(s.id)!.name, count: taskOffers.get(s.id)!.count }
        : null,
      taskCount: taskCounts.get(s.id) ?? 0,
      // Filing the conversation onto a chosen deal runs the SAME pass merging
      // already runs (`applySession` with an existing target) — the only thing
      // the pick changes is which record it is handed. See the merge route.
      pickActions:
        (taskCounts.get(s.id) ?? 0) > 0
          ? ['merge', 'task']
          : ['merge'],
      blocker: draft && !draft.ready ? draft.blocker : null,
    })
  }

  // --- Low-confidence AI extractions awaiting a human ----------------------
  for (const r of reviewRows ?? []) {
    // ⚠ These rows used to arrive with no title, no note and no verdict — 38
    // of them reading "Inferred email match" and nothing else, which is not a
    // decision anyone can make from a list. `ai_explanation` has held a
    // complete sentence naming the record all along ("Matched to this project
    // by same deal name — Myton Rail. Approve to post it and index it…"); the
    // page simply never selected it.
    const projectName = (r as { project?: { name?: string } | null }).project?.name ?? null
    items.push({
      id: r.id,
      kind: 'review',
      title: projectName ?? reviewReasonLabel(r.reason),
      // Never a bare `source_table`. Without a project name the reason IS the
      // title, so the subtitle says which record type it came off, in English.
      subtitle: projectName
        ? reviewReasonLabel(r.reason)
        : `from ${enumLabel(r.source_table, ACTIVITY_TABLE_LABELS).toLowerCase()}`,
      href: '/review',
      arrivedAt: r.created_at,
      verdict: null,
      score: r.confidence !== null ? Math.round(Number(r.confidence) * 100) : null,
      note: r.ai_explanation,
      deadline: null,
      accept: 'approve',
      acceptName: projectName,
      blocker: null,
    })
  }

  // --- Misfiled company documents ------------------------------------------
  //
  // Why these belong in a DECISION queue rather than a cleanup script: a
  // company-scoped passage is ORed into every project-scoped question
  // (`filter_include_company`) and handed to assessFit() as "RELEVANT BER
  // WILSON EVIDENCE". So a Phase 1 environmental report or a counterparty's
  // patents sitting in the company corpus quietly shape answers about other
  // deals — and where a document belongs is a judgement, never a
  // classification the model should make on its own (§12).
  for (const doc of unfiledDocs) {
    const isNotADocument = doc.target === null
    items.push({
      id: doc.id,
      kind: 'document',
      arrivedAt: doc.arrivedAt,
      title: doc.fileName,
      // The Drive shelf it came off. Often the only thing that says which deal
      // it is about — "Business Plan.docx" in "Corporate /M & A/GridEdge
      // Modular Datacenter" is unambiguous and its file name says nothing.
      subtitle: doc.folderPath,
      href: '/company',
      verdict: null,
      score: null,
      // What it costs to leave it: how many passages answer from the company
      // corpus today. This is the fact the decision turns on.
      //
      // ⚠ A ZERO HERE IS NOT NECESSARILY "NOT INDEXED". A document whose text
      // was indexed with its email thread holds no chunks of its own, so
      // `chunks` is 0 while the text is fully searchable — and saying nothing
      // about that would read as "this one answers nothing", the one claim that
      // makes the decision look free.
      note: doc.chunks > 0
        ? `${doc.chunks} indexed passage${doc.chunks === 1 ? '' : 's'} answering as Ber Wilson company knowledge${doc.reason ? ` — ${doc.reason}` : ''}`
        : doc.mailChunks > 0
          ? `${doc.mailChunks} passage${doc.mailChunks === 1 ? '' : 's'} indexed with its email thread, not as company knowledge${doc.reason ? ` — ${doc.reason}` : ''}`
          : doc.reason,
      deadline: null,
      accept: isNotADocument ? 'setaside' : 'file',
      acceptName: isNotADocument ? doc.fileName : (doc.target?.name ?? null),
      fileTarget: doc.target ? { kind: doc.target.kind, id: doc.target.id } : null,
      // Never thresholded as a number at the reader; it only draws the batch.
      confidence: doc.confidence ?? (isNotADocument ? 1 : null),
      pickActions: ['file'],
      blocker: null,
    })
  }

  // --- Files off deal mail that are on no record --------------------------
  //
  // Why this is a decision and not a script: these arrived as email attachments
  // on deal correspondence the router could not place, so nothing in the system
  // knows which deal they belong to — and `matchDocument` proposing one is a
  // proposal, never a fact. Where a document belongs is a judgement (§12).
  //
  // ⚠ WHY THIS CLASS EXISTS AT ALL. Attachment import required a `thread_links`
  // row, and only 244 of 1,984 deal threads (12%) have one, so a file on
  // unmatched mail was imported NOWHERE. Measured 2026-10-25: 809 attachments on
  // 422 threads, in no corpus — not as documents, not as mail chunks, not in any
  // queue, not on any health card. `Tensor IQ Teaming Agreement 1.6`, a
  // `Quit Claim Deed`, an `Engagement letter` and 11 files on `Carbon County`
  // were among them, all on threads the summarizer itself called
  // `relevance='deal'`. The import now runs without a parent and this is where
  // the parent gets decided.
  //
  // The cost of leaving one is the MIRROR of the company-knowledge class above,
  // which is why they are two chips and not one: an unfiled company document is
  // answering, wrongly, for every project-scoped question; one of these answers
  // nothing, for anybody.
  for (const doc of unparented.offered) {
    const isNotADocument = doc.target === null
    items.push({
      id: doc.id,
      kind: 'unparented',
      arrivedAt: doc.arrivedAt,
      title: doc.fileName,
      // ⚠ THE THREAD'S SUBJECT, WHICH IS USUALLY THE ONLY CONTEXT THERE IS.
      // `Package.pdf` and `Quit Claim Deed` name no record; the conversation
      // that delivered them is what makes the row answerable at a glance.
      subtitle: doc.sourceSubject ? `arrived on "${doc.sourceSubject}"` : 'from email',
      href: '/intake',
      verdict: null,
      score: null,
      // What it costs to leave it. ⚠ A ZERO HERE IS THE EXPENSIVE CASE, the
      // opposite of the company queue where zero means "answering nothing yet,
      // so this is cheap to leave". These rows are filed on no record, so if the
      // text is not in the mail index either, the file is reachable by nothing.
      note: isNotADocument
        ? (doc.reason ?? 'not a document')
        : doc.mailChunks > 0
          ? `${doc.mailChunks} passage${doc.mailChunks === 1 ? '' : 's'} searchable with its email thread, but the file is on no record${doc.reason ? ` — ${doc.reason}` : ''}`
          : `On no record and not indexed — nothing can answer from this file today${doc.reason ? `. ${doc.reason}` : ''}`,
      deadline: null,
      accept: isNotADocument ? 'setaside' : 'file',
      acceptName: isNotADocument ? doc.fileName : (doc.target?.name ?? null),
      fileTarget: doc.target ? { kind: doc.target.kind, id: doc.target.id } : null,
      fileSource: 'documents',
      confidence: doc.confidence ?? (isNotADocument ? 1 : null),
      pickActions: ['file'],
      blocker: null,
    })
  }

  // --- Documents on the wrong deal ----------------------------------------
  //
  // Why this is a decision and not a script: these are confident proposals, and
  // a confident proposal is still a proposal. Moving a document changes which
  // deal answers for it — 384 indexed passages at the time of writing — and
  // where a document belongs is a judgement (§12). The two causes behind every
  // row are in the header of misfiled.ts; the fan-out that produced most of
  // them is fixed at source, so this list should shrink and not refill.
  for (const doc of misfiledDocs) {
    items.push({
      id: doc.id,
      kind: 'misfiled',
      arrivedAt: doc.arrivedAt,
      title: doc.fileName,
      // Where it sits TODAY. The accept button names where it would go, so the
      // two together read as the move without the row having to spell it out.
      subtitle: `on ${doc.sitsOn.name}${doc.folderPath ? ` · ${doc.folderPath}` : ''}`,
      href: doc.sitsOn.kind === 'project' ? `/projects/${doc.sitsOn.id}/documents` : `/opportunities/${doc.sitsOn.id}/documents`,
      verdict: null,
      score: null,
      // The fact the decision turns on: what it costs to leave it. A document
      // with no chunks is misfiled and answering nothing, which is a smaller
      // problem and says so rather than being padded into the same sentence.
      //
      // ⚠ Unless its text is indexed with its THREAD, in which case it is
      // searchable and only the FILE is on the wrong deal. Saying "not indexed"
      // over that document would have been false, and false in the direction
      // that makes the row look safe to leave.
      note: doc.chunks > 0
        ? `${doc.chunks} indexed passage${doc.chunks === 1 ? '' : 's'} answering for ${doc.sitsOn.name} instead of ${doc.target.name} — ${doc.reason}`
        : doc.mailChunks > 0
          ? `Filed on ${doc.sitsOn.name}, names ${doc.target.name} — ${doc.reason}. Its ${doc.mailChunks} passage${doc.mailChunks === 1 ? '' : 's'} are indexed with its email thread, so filing moves the file and not the text.`
          : `Filed on ${doc.sitsOn.name}, names ${doc.target.name} — ${doc.reason}. Not indexed, so nothing is answering from it yet.`,
      deadline: null,
      accept: 'file',
      acceptName: doc.target.name,
      fileTarget: { kind: doc.target.kind, id: doc.target.id },
      fileSource: doc.side === 'opportunity' ? 'opportunity_documents' : 'documents',
      confidence: doc.confidence,
      pickActions: ['file'],
      blocker: null,
    })
  }

  // --- Guarded fields Pepper will not overwrite ----------------------------
  //
  //
  // Why these are a DECISION and not a write: the registry
  // (lib/provenance/fields.ts) marks a field `guarded` when being wrong about
  // it costs money or a legal position — stage, status, a bid due date, an
  // estimated value, an equity split. Pepper fills those freely when they are
  // blank, and when a HUMAN has typed one she proposes instead. Until
  // 2026-10-15 the proposal went into a table with no reader anywhere: three
  // module headers describe reporting as the thing that makes unattended
  // writing safe, and the questions were accumulating unasked.
  for (const q of fieldQuestions.proposals) {
    items.push({
      id: q.id,
      kind: 'proposal',
      arrivedAt: q.at,
      title: `${q.recordLabel} — ${q.fieldLabel}`,
      subtitle: q.recordLabel,
      href: recordHref(q.table, q.recordId),
      verdict: null,
      score: null,
      note:
        `On file: ${q.current ?? 'blank'}. The correspondence says: ${q.proposed ?? 'blank'}.` +
        (q.evidence ? ` ${q.evidence}` : ''),
      deadline: null,
      accept: 'confirmfield',
      acceptName: `${q.recordLabel}'s ${q.fieldLabel.toLowerCase()}`,
      // ⚠ NEVER BATCH-SELECTED BY CONFIDENCE. These are precisely the fields
      // where a confident model is not sufficient grounds — that is what
      // `guarded` MEANS — so there is no score to draw a batch with and the
      // row has to be read. Leaving it null keeps it out of
      // "select the N Ber AI is sure about".
      confidence: null,
      blocker: null,
    })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Gavel}
        title="Decide"
        description={
          <>
            Current business waiting on a call from you — staged correspondence and
            calls, documents filed on the wrong deal, and anything Ber AI wasn&apos;t sure
            about. Ordered by consequence until you sort it another way, and nothing
            here has been created yet. Inbound bid invitations are worked on{' '}
            <Link href="/leads" className="underline underline-offset-2 hover:text-foreground">
              Leads
            </Link>
            .
          </>
        }
        className="mb-0"
      />

      {/*
        ⚠ THE HELD COUNT, BECAUSE A GATE NOBODY CAN SEE IS A BLACK HOLE (§12).
        `matchDocument` proposes nothing for most unparented files — correctly,
        since reaching for the closest record is how real evidence lands on the
        wrong deal — so they are kept OUT of the queue above, which is what lets
        it reach zero. But these particular rows are filed on no record at all,
        so "held" means "answering nothing and not on anybody's list". Saying so
        in one line is the difference between a deliberate hold and a loss.
      */}
      {unparented.held > 0 && (
        /*
          ⚠ A CALLOUT, NOT A SECOND PARAGRAPH. It rendered as plain muted prose
          directly under the page description, in the same size and colour, at
          the full 1,451px of the column — so the one actionable FACT on the
          page outside the queue was visually indistinguishable from the page's
          own blurb, and read as more preamble. It is a different kind of thing
          from a description: a count, with somewhere to go.
        */
        <div className="flex max-w-3xl items-start gap-2.5 rounded-lg border border-info-edge bg-info-surface px-3.5 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="text-sm text-foreground">
            <span className="tnum font-medium">{unparented.held}</span> further{' '}
            {unparented.held === 1 ? 'file is' : 'files are'} held back: they came off deal
            mail and sit on no record, but nothing in their name or text points at a
            particular deal, so there is no filing to offer — but you will know which
            deal each one belongs to at a glance.{' '}
            <Link
              href="/documents/unfiled"
              className="font-medium text-info underline underline-offset-2"
            >
              Pick their deals
            </Link>
            .
          </p>
        </div>
      )}

      <DecideClient
        items={items}
        records={records}
        initialSort={initialSort}
        initialKind={initialKind}
        initialQuery={initialQuery}
      />
    </div>
  )
}

function readPredecision(raw: unknown): {
  disposition: 'create' | 'merge' | 'dismiss'
  merge_target_name?: string | null
  headline?: string | null
  reason?: string | null
  /** 0-1. How sure the pre-decision was — read but never shown as a number. */
  confidence?: number | null
} | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const d = String(o.disposition ?? '')
  if (d !== 'create' && d !== 'merge' && d !== 'dismiss') return null
  return {
    disposition: d,
    merge_target_name: typeof o.merge_target_name === 'string' ? o.merge_target_name : null,
    headline: typeof o.headline === 'string' ? o.headline : null,
    reason: typeof o.reason === 'string' ? o.reason : null,
    confidence: typeof o.confidence === 'number' && isFinite(o.confidence) ? o.confidence : null,
  }
}
