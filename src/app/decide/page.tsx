import { Gavel } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import DecideClient, { type DecideItem, type AcceptAction } from '@/components/decide/DecideClient'
import { reviewReasonLabel } from '@/lib/utils/review'
import { enumLabel, ACTIVITY_TABLE_LABELS } from '@/lib/utils/constants'
import { buildConfirmBody } from '@/lib/email-ingestion/defaults'
import { parseStagedAttachments } from '@/lib/email-ingestion/attachments'
import { promoteTargetFor } from '@/lib/utils/leads'
import { listCategories } from '@/lib/leads/categories'
import { findMisfiledCompanyDocuments } from '@/lib/documents/unfiled'
import { pendingProposalGroups } from '@/lib/economics/store'
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
export default async function DecidePage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const supabase = createAdminClient()

  const [{ data: sessions }, { data: leadRows }, { data: reviewRows }, unfiledDocs, economicsGroups] = await Promise.all([
    supabase
      .from('email_intake_sessions')
      .select(
        'id, label, status, updated_at, predecision, fit_assessment, intake_kind, extraction_result, party_matches, staged_attachments'
      )
      .eq('status', 'pending')
      .order('updated_at', { ascending: false })
      .limit(200),
    leadsDb()
      .from('leads')
      .select('*')
      .in('status', ['new', 'reviewing'])
      // NOT by fit_score. The list is ranked by decideWeight (deadline, then
      // verdict band, then value) in the client; ordering the fetch by a noisy
      // score only decided which 200 rows survived the limit. Newest first is
      // the honest cut.
      .order('received_at', { ascending: false, nullsFirst: false })
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
    pendingProposalGroups().catch(() => []),
  ])

  const items: DecideItem[] = []

  // --- Inbound leads: unclaimed bid invitations, best first -----------------
  // The routing registry, read once for the whole page.
  const categories = await listCategories()
  const byKey = new Map(categories.map((c) => [c.key, c]))

  /**
   * What accepting a lead from this queue does, and why it sometimes cannot.
   *
   * Three distinct outcomes, and they must not collapse into one: a lane with a
   * destination is acceptable in place; an unsorted lead needs a human to place
   * it; and a handoff lane with no address configured is acceptable in
   * principle but would fail on press. That last one is the case worth naming —
   * it is the DINO_LEAD_EMAIL failure, where a live-looking button 400'd.
   */
  function leadAccept(route: string): {
    action: AcceptAction | null
    to: string | null
    blocker: string | null
  } {
    const category = byKey.get(route)
    const action = promoteTargetFor(category?.destination)
    if (!action) {
      return {
        action: null,
        to: null,
        blocker: 'Unsorted — open the lead and choose its line of business.',
      }
    }
    if (action === 'handoff' && !category?.handoff_email?.includes('@')) {
      return {
        action: null,
        to: null,
        blocker: `${category?.label ?? 'This line of business'} has no handoff address — add one in Settings → Lead categories.`,
      }
    }
    return { action, to: action === 'handoff' ? (category?.label ?? null) : null, blocker: null }
  }

  for (const raw of (leadRows ?? []) as LeadRow[]) {
    if (raw.fit_recommendation === 'pass') continue
    items.push({
      id: raw.id,
      kind: 'lead',
      title: raw.title,
      subtitle: raw.sender_company ?? raw.sender_name ?? null,
      href: `/leads?lead=${raw.id}`,
      verdict: raw.fit_recommendation ?? null,
      score: raw.fit_score,
      note: raw.fit_summary,
      // A bid date is the only hard deadline in the whole list. Days-remaining
      // is derived client-side from a clock captured once at mount, rather than
      // during a server render — see DecideClient.
      deadline: raw.bid_due_date,
      // Already on the row — the select above is `*`. These used to be thrown
      // away here and left for the reader to find inside `fit_summary`.
      facts: {
        value: raw.estimated_value,
        location: raw.location,
        sector: raw.sector,
        ref: raw.solicitation_number,
        extraDate: raw.site_visit_date
          ? { label: 'site visit', date: raw.site_visit_date }
          : raw.rfi_due_date
            ? { label: 'RFI by', date: raw.rfi_due_date }
            : null,
      },
      // The line of business the triage already chose says which record this
      // becomes; an unsorted lead offers no Accept rather than guessing between
      // five destinations.
      accept: leadAccept(raw.route).action,
      acceptTo: leadAccept(raw.route).to,
      blocker: leadAccept(raw.route).blocker,
    })
  }

  // --- Staged correspondence, carrying Ber AI's recommendation --------------
  for (const s of sessions ?? []) {
    const pre = readPredecision(s.predecision)
    if (pre?.disposition === 'dismiss') continue // auto-handled or low value
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
      subtitle: pre?.merge_target_name ? `Merge into ${pre.merge_target_name}` : null,
      href: `/email-ingestion/${s.id}`,
      verdict: pre?.disposition ?? null,
      score: Number.isFinite(score) ? score : null,
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
      note: doc.chunks > 0
        ? `${doc.chunks} indexed passage${doc.chunks === 1 ? '' : 's'} answering as Ber Wilson company knowledge${doc.reason ? ` — ${doc.reason}` : ''}`
        : doc.reason,
      deadline: null,
      accept: isNotADocument ? 'setaside' : 'file',
      acceptName: isNotADocument ? doc.fileName : (doc.target?.name ?? null),
      fileTarget: doc.target ? { kind: doc.target.kind, id: doc.target.id } : null,
      // Never thresholded as a number at the reader; it only draws the batch.
      confidence: doc.confidence ?? (isNotADocument ? 1 : null),
      blocker: null,
    })
  }

  // ⚠ ONE ROW PER DEAL, NOT PER FIGURE, matching what the badge counts. Forty
  // figures read out of one proposal document are one sitting, and a global
  // queue row saying "accept 145 $/kW-month" has no model beside it, which is
  // precisely where that decision cannot be made. This points at the tab, the
  // same way an unfiled document points at /company: the queue aggregates and
  // the deciding happens where the detail is.
  for (const group of economicsGroups) {
    items.push({
      id: `economics-${group.economicsId}`,
      kind: 'economics',
      title: `${group.count} economics figure${group.count === 1 ? '' : 's'} read from ${group.recordName}`,
      subtitle: group.recordName,
      href: group.path,
      verdict: null,
      score: null,
      note: 'Each one carries the sentence it came from. Accepting records the figure and its source together; nothing has been written yet.',
      deadline: null,
      // Deliberately not acceptable from this list: the quote has to be read
      // against the model, and a batch accept here would write figures nobody
      // had looked at.
      accept: null,
      blocker: 'Open the deal to read each figure against its quote',
      confidence: null,
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Gavel className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl">Decide</h1>
          <p className="text-sm text-muted-foreground">
            Everything waiting on a call from you, in one list — inbound bids, staged
            correspondence, and anything Ber AI wasn&apos;t sure about. Ranked so the most
            consequential is first. Nothing here has been created yet.
          </p>
        </div>
      </div>

      <DecideClient items={items} />
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
