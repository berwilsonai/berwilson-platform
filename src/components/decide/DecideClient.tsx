'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Inbox, ClipboardCheck, FileText, FileQuestion, ArrowRight, X, Loader2, Check, CheckCheck, HelpCircle, ListChecks, Link2, Search, Sparkles, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/card'
import { Kbd } from '@/components/ui/kbd'
import EmptyState from '@/components/shared/EmptyState'
import {
  daysUntil,
  meetingBoost,
  decideComparator,
  asDecideSort,
  DECIDE_SORTS,
  type DecideSort,
} from '@/lib/decide/rank'
import { Segmented } from '@/components/ui/segmented'
import { planAccept } from '@/lib/decide/accept-request'
import type { DecideKind, AcceptAction } from '@/lib/decide/types'
import { filterByWords } from '@/lib/utils/search'
import { enumLabel, formatValue, formatDate } from '@/lib/utils/constants'
import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import RecordPicker, { type PickableRecord } from '@/components/shared/RecordPicker'

/**
 * ⚠ NO KIND CURRENTLY FILLS THIS, AND THAT IS WHY IT IS DOCUMENTED RATHER THAN
 * DELETED. `facts` and `deadline` existed for the lead rows, which left this
 * page on 10-22; every remaining producer passes `deadline: null` and none
 * passes `facts`. So the deadline chip, the header's "N closing within a week"
 * and `decideWeight`'s deadline band are all inert here today.
 *
 * Kept because they degrade to nothing rather than misreporting, and because
 * `decideWeight` is shared with `summarizeDecideQueue`. ⚠ But do NOT read the
 * code as evidence that this page ranks on deadlines — it cannot until
 * something fills these again. §12: a comment claiming a control that is not
 * there is worse than no comment, and this is the mirror of it.
 */
/**
 * Re-exported so a surface importing `DecideItem` from here still gets the
 * vocabulary that describes it. The declarations live in `@/lib/decide/types`.
 */
export type { DecideKind, AcceptAction }

export interface DecideFacts {
  /** Estimated contract value in dollars. */
  value?: number | null
  location?: string | null
  /** A stored sector enum — rendered through SECTOR_LABELS, never raw. */
  sector?: string | null
  /** Solicitation / reference number, when the source carries one. */
  ref?: string | null
  /** A second date that is not the bid deadline, already labelled. */
  extraDate?: { label: string; date: string } | null
}

export interface DecideItem {
  id: string
  kind: DecideKind
  title: string
  subtitle: string | null
  href: string
  /** pursue/consider for leads, create/merge for intake, null for review. */
  verdict: string | null
  score: number | null
  note: string | null
  deadline: string | null
  /**
   * When the thing HAPPENED, for a kind that is time-sensitive without having a
   * deadline — today only a staged meeting. The ranking lift is derived from it
   * at render time, beside the deadline, off the one clock reading this
   * component captures. See meetingBoost.
   */
  occurredAt?: string | null
  /**
   * When this row ARRIVED in the queue, which is a different question from
   * `occurredAt` above and from `deadline`.
   *
   * ⚠ EVERY PRODUCER FILLS THIS; `decide-sort.test.ts` asserts it. A meeting
   * `occurredAt` last Tuesday may have been staged this morning, and the reader
   * asking "what is new since I last looked" means the staging, not the call.
   * Nulling it for one kind would sink that kind to the bottom of the recent
   * view, where it reads as dealt with — see SortableDecideItem.arrivedAt.
   */
  arrivedAt?: string | null
  /**
   * The facts the decision actually turns on.
   *
   * These were always available — `leads` carries `estimated_value`,
   * `location`, `sector` and `solicitation_number` as columns and the page
   * already does `select('*')` — but the row flattened everything into a
   * paragraph and then clipped the paragraph at three lines. The reader was
   * being asked to find "$12M, Mapleton, UT, education" inside a sentence that
   * ran off the right edge.
   *
   * Not every source can fill these. A `review_queue` row genuinely has
   * nothing but a confidence and an explanation, so the strip renders what
   * exists and the prose carries the rest — the row degrades, it does not
   * invent parity.
   */
  facts?: DecideFacts | null
  /**
   * What accepting this row does, or null when it cannot be accepted from the
   * list. Computed server-side — the client is never handed enough of the
   * record to decide for itself.
   */
  accept: AcceptAction | null
  /**
   * The record's name — read by the confirmation AND, since 10-22, by the
   * button itself for the actions whose destination is the decision ("File
   * onto Steelton", "Task on Steelton"). See acceptVerb.
   */
  acceptName?: string | null
  /**
   * A SECOND answer this row can give, beside its primary Accept.
   *
   * ⚠ ONE ACCEPT PER ROW WAS THE LIMIT THAT HID THE REAL ANSWER. A staged
   * conversation could be turned into a whole record, filed onto one, or
   * dismissed — and "put its follow-ups on Steelton and leave the conversation
   * alone" was none of those, so it meant leaving the page. A recorded meeting
   * was worse: `accept: null`, so the row offered nothing at all but a link.
   *
   * Rendered quieter than the primary and NEVER tickable for a batch: the whole
   * point is that it is the second-choice answer, and a batch that mixed
   * "create these" with "task these" would be one button doing two things to
   * rows the reader selected for one of them.
   */
  altAccept?: { action: AcceptAction; name: string; count: number } | null
  /**
   * How many follow-ups this staged conversation holds.
   *
   * Separate from `altAccept`, which only exists where the title RESOLVES a
   * deal. The count is what makes "choose the deal yourself" worth offering on
   * a row whose title resolves nothing — which is every recorded call, since
   * `Call with <person>` names nobody's deal by design.
   */
  taskCount?: number
  /**
   * What this row can be made to do once a person NAMES the record.
   *
   * ⚠ COMPUTED SERVER-SIDE LIKE `accept`, and for the same reason: the browser
   * is never handed enough of the portfolio or of the session to know which
   * writes are available. It also keeps the one real asymmetry honest — a
   * recorded call can have its follow-ups taken onto any deal, but filing the
   * CALL needs its own screen (see the page's comment), so a meeting offers
   * `task` and never `merge`.
   *
   * Empty or absent means no picker — a flagged extraction and a field question
   * are both about a record that is already chosen.
   */
  pickActions?: AcceptAction[]
  /**
   * Where a `file` accept sends the document.
   *
   * Carried on the row rather than re-derived in the client, for the same
   * reason `accept` is computed server-side: the browser never sees enough of
   * the portfolio to choose a record, and a filing decision that guessed would
   * be indistinguishable from one that knew.
   */
  fileTarget?: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string } | null
  /**
   * Which table this document row lives in, for the refile call.
   *
   * Omitted means `documents`, which is every company-knowledge row. An
   * opportunity's documents are their own table, and sending the default for
   * one of those is a refused request rather than a wrong write.
   */
  fileSource?: 'documents' | 'opportunity_documents' | null
  /** Why Accept is unavailable. Shown in place of the button. */
  blocker?: string | null
  /**
   * 0-1 — how sure the pre-decision was, where one was made.
   *
   * Used to draw the batch, never shown as a number. §12 says a fit_score
   * carries ±20 points of noise and must not be sorted or thresholded on; this
   * is a different quantity (the intake pre-decision's own confidence, measured
   * at 0.93 average across the 80-item backlog) and it is still only ever used
   * to pick a default selection a human then looks at.
   */
  confidence?: number | null
}

/** An item with its days-to-deadline resolved against a fixed clock. */
type Dated = DecideItem & { daysLeft: number | null }

const KIND_META: Record<DecideKind, { label: string; icon: LucideIcon; tone: string }> = {
  intake: {
    label: 'Correspondence',
    icon: Inbox,
    tone: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900',
  },
  review: {
    label: 'Needs a check',
    icon: ClipboardCheck,
    tone: 'bg-caution-surface text-caution ring-caution-edge',
  },
  document: {
    label: 'Unfiled document',
    icon: FileText,
    tone: 'bg-caution-surface text-caution ring-caution-edge',
  },
  // Deliberately NOT the same chip as 'document'. An unfiled document has no
  // deal; a misfiled one has the wrong deal, and the two are read differently —
  // one is a gap, the other is an answer already being given about the wrong
  // record. One label for both quantities is how a reader stops trusting
  // either (§12).
  /**
   * A guarded field Pepper will not overwrite.
   *
   * Its own chip, not folded into 'review': a flagged AI item is something the
   * model was unsure about, where this is something the model is CONFIDENT
   * about and declines to do anyway, because a person typed the value and being
   * wrong about money or a closing date costs something. Two quantities, named
   * apart (§12).
   */
  proposal: {
    label: 'Field question',
    icon: HelpCircle,
    tone: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900',
  },
  /**
   * A file off deal mail that is on NO record — a third quantity, named apart.
   *
   * ⚠ NOT folded into 'document', although both are "unfiled". The costs are
   * opposites and a reader has to be able to tell them apart: an unfiled
   * company document is ANSWERING, wrongly, for every project-scoped question;
   * an unparented one answers NOTHING, for anybody. One label for two
   * quantities is how a reader stops trusting either (§12).
   */
  unparented: {
    label: 'No deal yet',
    icon: FileQuestion,
    tone: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  },
  misfiled: {
    label: 'Wrong deal',
    icon: FileText,
    tone: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
  },
}

/**
 * What each verdict is CALLED. `pursue` is a stored token; "Pursue" is what a
 * person reads. The score that used to follow it is gone on purpose —
 * CLAUDE.md §12: a fit score carries ±20 points of sampling noise, so read the
 * verdict, never the number. Four consecutive rows reading `pursue 85` was the
 * proof: the digits were discriminating nothing.
 */
/**
 * The decision's facts, in the order they get read: what is it worth, where is
 * it, what kind of work, what is it called, and any date that is not the bid
 * deadline (that one is already beside the title).
 *
 * Absent fields are OMITTED, never dashed. An em dash at the value's weight
 * reads as a broken render; saying nothing reads as nothing to say.
 */
function factStrip(
  facts: DecideFacts | null | undefined
): { key: string; text: string; strong?: boolean }[] {
  if (!facts) return []
  const out: { key: string; text: string; strong?: boolean }[] = []
  if (facts.value != null && facts.value > 0) {
    out.push({ key: 'value', text: formatValue(facts.value), strong: true })
  }
  if (facts.location) out.push({ key: 'location', text: facts.location })
  if (facts.sector) out.push({ key: 'sector', text: enumLabel(facts.sector, SECTOR_LABELS) })
  if (facts.extraDate) {
    out.push({
      key: 'extraDate',
      text: `${facts.extraDate.label} ${formatDate(facts.extraDate.date, { year: false })}`,
    })
  }
  if (facts.ref) out.push({ key: 'ref', text: facts.ref })
  return out
}

const VERDICT_LABEL: Record<string, string> = {
  pursue: 'Pursue',
  consider: 'Consider',
  create: 'Create',
  merge: 'Merge',
}

const VERDICT_TONE: Record<string, string> = {
  pursue: 'bg-positive-surface text-positive ring-positive-edge',
  create: 'bg-positive-surface text-positive ring-positive-edge',
  consider: 'bg-muted text-foreground ring-border dark:bg-muted/60 dark:text-muted-foreground',
  merge: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
}

/**
 * How each kind of item is set aside, and what that means.
 *
 * Every one of these is reversible and none of them delete: a lead becomes
 * "ignored" (the documented choice on 2026-09-15 — the queue is kept so the
 * triage can be audited), a staged session is dismissed without creating
 * anything, and a flagged extraction is rejected, which also drops the
 * inferred link that put it there.
 */
/**
 * ⚠ STILL `Partial`, THOUGH EVERY KIND HAS AN ENTRY TODAY. It was Partial for
 * the economics lane, which could not be set aside from an aggregate — its
 * figures had to be read against the model and the quote they came from — and
 * that lane left this page with the calculator on 2026-10-23. The type stays
 * Partial because the behaviour it buys is the right default: a kind with no
 * entry renders no Set-aside button rather than one that fails, so the next
 * lane added here cannot ship a button that points at nothing.
 */
const DISMISS: Partial<
  Record<
    DecideKind,
    { url: (id: string) => string; body: (item: DecideItem) => unknown; verb: string }
  >
> = {
  intake: {
    url: (id) => `/api/email-ingestion/sessions/${id}`,
    body: () => ({}),
    verb: 'Correspondence dismissed',
  },
  review: {
    url: (id) => `/api/review/${id}`,
    body: () => ({ resolution: 'rejected' }),
    verb: 'Flagged item rejected',
  },
  /**
   * Dismissing an unfiled document means "it is right where it is".
   *
   * That is a real answer, not an absence of one — so it is RECORDED
   * (filing_confirmed_at) rather than merely hidden. The queue is computed
   * from the records rather than stored, so anything not written down comes
   * back on the next page load, and a queue that cannot reach zero teaches
   * people to accept rows just to clear them.
   */
  document: {
    url: (id) => `/api/documents/${id}/refile`,
    body: (item) => ({ confirm: true, source: item.fileSource ?? 'documents' }),
    verb: 'Kept as company knowledge',
  },
  /**
   * Dismissing a NO-DEAL row means "it belongs to no deal, leave it".
   *
   * ⚠ THIS KIND HAD NO ENTRY AND THEREFORE NO SET-ASIDE BUTTON AT ALL, which
   * made it the one row in the queue with no way to say "nothing to do here".
   * The `Partial` on this map is what kept that honest rather than shipping a
   * button that wrote nothing — but honest and absent is still absent, and a
   * queue that cannot reach zero teaches people to accept rows to clear them.
   *
   * It is a real answer and not an absence of one: a blank MNDA template, a
   * generic W-9, an insurance certificate — these arrived on deal mail and
   * belong to no deal, and `filing_confirmed_at` is what stops the pass
   * offering them again tomorrow. The file is kept and stays searchable; only
   * the question goes away. Distinct from the `setaside` ACCEPT on the same
   * row, which means "this is not a document" and drops its passages.
   */
  unparented: {
    url: (id) => `/api/documents/${id}/refile`,
    body: (item) => ({ confirm: true, source: item.fileSource ?? 'documents' }),
    verb: 'Left on no deal, on purpose',
  },
  /**
   * Dismissing a WRONG-DEAL row means "it is on the right deal after all".
   *
   * Same write, different sentence — and the sentence matters, because the two
   * rows are read differently. Saying "kept as company knowledge" about a
   * document sitting on Weirton would be false: it is not company knowledge and
   * never was, it is Weirton's. A provenance line that invents a provenance is
   * worse than no line (§12).
   */
  misfiled: {
    url: (id) => `/api/documents/${id}/refile`,
    body: (item) => ({ confirm: true, source: item.fileSource ?? 'documents' }),
    verb: 'Kept on this deal',
  },
  /**
   * Dismissing a field question means "the value on file is right".
   *
   * A real answer, and recorded as one — the same reasoning as the document
   * rows above. The queue is computed from pending rows, so a question that is
   * merely hidden comes back tomorrow morning in the note as well as here, and
   * a queue that cannot reach zero teaches people to accept rows to clear them.
   */
  proposal: {
    url: (id) => `/api/provenance/proposals/${id}`,
    body: () => ({ verdict: 'reject' }),
    verb: 'Kept what you had',
  },
}

async function readError(res: Response): Promise<never> {
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  throw new Error(data.error ?? `Failed (${res.status})`)
}

async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) await readError(res)
  return res.json().catch(() => ({}))
}

async function patch(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) await readError(res)
  return res.json().catch(() => ({}))
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) await readError(res)
  return res.json()
}

/**
 * The actions that still stop and ask, and the only ones.
 *
 * Richard, 2026-10-30: *"When I do, I want it to be a click (no confirmation)
 * so I can get through them quickly."*
 *
 * ⚠ THE LINE IS REVERSIBILITY, NOT IMPORTANCE. Filing a conversation onto a
 * deal, making a task, approving a match, setting a document aside and
 * confirming a field are all one write that a later press undoes — on a queue
 * worked in batches of seventy, a dialog on each is a second click that
 * teaches people to stop reading the first one. Creating a project or an
 * opportunity is different in kind: it writes the record, its contacts, its
 * tasks, its attachments, and builds a Drive room. There is no single press
 * that takes that back, so those two keep one confirmation.
 *
 * ⚠ AND `setaside` IS NOT HERE DELIBERATELY, even though it removes something
 * from Ber AI's reach. `excludeDocument` writes a tombstone — the ROW IS THE
 * TOMBSTONE (§4) — so the file is kept and only its passages go. That is the
 * single most repeated press in the junk-attachment queue this change exists
 * to drain; it is also the most reversible thing on the screen.
 *
 * Typed `Record<AcceptAction, boolean>`, not a Set, so the build names a new
 * action that nobody decided about (§12 — the fix that ends the drift is the
 * TYPE, not the derivation). A new action must be classified, and the honest
 * default for an unclassified one is not "fire silently".
 */
const CONFIRM_BEFORE: Record<AcceptAction, boolean> = {
  project: true,
  opportunity: true,
  merge: false,
  task: false,
  approve: false,
  file: false,
  confirmfield: false,
  setaside: false,
}

/**
 * What each accept says before it happens, and what it says afterwards.
 *
 * `ask` is only ever read for an action `CONFIRM_BEFORE` marks true — the rest
 * never render it. It is kept for all of them anyway, because the sentence is
 * the clearest statement of what each write actually does and the next person
 * reclassifying an action will want to read it.
 */
const ACCEPT_COPY: Record<
  AcceptAction,
  { verb: string | ((n: string | null) => string); ask: (n: string) => string; done: string }
> = {
  project: {
    verb: 'Create project',
    ask: (n) => `Create the project “${n}” from this correspondence, with its people, tasks and attachments?`,
    done: 'Project created',
  },
  opportunity: {
    verb: 'Create opportunity',
    ask: (n) => `Create the opportunity “${n}” from this correspondence, with its people, tasks and attachments?`,
    done: 'Opportunity created',
  },
  /**
   * ⚠ THIS BUTTON SAID "MERGE" UNTIL 10-22, WHICH IS A DATABASE WORD FOR
   * FILING A CONVERSATION ONTO A DEAL. Nothing is merged — no two records are
   * combined and nothing is overwritten; the thread and its attachments join a
   * record that already exists. The verb now names the deal, so the row reads
   * as the sentence it is: "File onto Steelton". §12 — never print a stored
   * token at a reader, and the same applies to the vocabulary of the write.
   *
   * `verb` is a function here where the others are strings, because the deal's
   * name is the informative half; with no name it degrades to the old wording
   * rather than rendering "File onto undefined".
   */
  merge: {
    verb: (n) => (n ? `File onto ${n}` : 'File onto the record'),
    ask: (n) => `File this correspondence onto “${n}”? Nothing new is created — the conversation and its attachments join the existing record.`,
    done: 'Filed onto the existing record',
  },
  task: {
    verb: (n) => (n ? `Task on ${n}` : 'Make it a task'),
    ask: (n) =>
      n
        ? `Add this as a task on “${n}”? The follow-up and its context are written to the task board — no project, opportunity or contact is created.`
        : `Add this as an unassigned task? It will sit on the board with no deal attached until somebody files it.`,
    done: 'Task created',
  },
  approve: {
    verb: 'Approve',
    ask: (n) => `Approve this match${n ? ` onto “${n}”` : ''}? The correspondence is posted to the record and indexed.`,
    done: 'Match approved',
  },
  file: {
    /*
      ⚠ IT NAMES THE DEAL, like `merge` and `task` beside it. "File on record"
      described a mechanism on a row whose whole question is WHICH record —
      and once the picker could supply one, three buttons in the same dialog
      would all have read the same four words. Degrades to the old wording
      with no name rather than rendering "File onto undefined".
    */
    verb: (n: string | null) => (n ? `File onto ${n}` : 'File on record'),
    ask: (n) =>
      `File this document on “${n}”? Its indexed passages move with it, so it stops widening every other project's answers and starts answering for this one. Nothing is re-read and nothing is deleted.`,
    done: 'Filed on the record',
  },
  confirmfield: {
    verb: 'Use the new value',
    ask: (n) =>
      `Update ${n} to what the correspondence says? You typed the value on file, so I left it alone — this replaces it and records the change as yours.`,
    done: 'Field updated',
  },
  setaside: {
    verb: 'Set aside',
    ask: (n) =>
      `Set “${n}” aside? The file is kept and only its indexed passages go, so Ber AI stops answering from it. Reversible, and the nightly Drive sync will not bring it back.`,
    done: 'Set aside',
  },
}

/**
 * The button's words.
 *
 * ⚠ IT NAMES THE RECORD WHERE THE RECORD IS THE POINT. "Merge" and "Task" both
 * describe a mechanism; "File onto Steelton" and "Task on Steelton" describe
 * what will have happened, and the reader is choosing between deals, not
 * between verbs. Two rows that both said "Merge" were the same button twice.
 *
 * The lead verbs this used to special-case ("Hand off to Dino Plumbing") are
 * gone with the lead rows — a handoff is pressed on /leads now, which is the
 * only place a lead lives (10-22).
 */
function acceptVerb(item: { accept: AcceptAction | null; acceptName?: string | null }): string {
  // Nullable rather than narrowed at each call site: every caller already sits
  // behind an `item.accept &&` guard, but the guard is on a property of an
  // object and TypeScript cannot narrow the object from it.
  if (!item.accept) return 'Accept'
  const verb = ACCEPT_COPY[item.accept].verb
  return typeof verb === 'function' ? verb(item.acceptName ?? null) : verb
}

/**
 * Put the view in the address bar, so it can be linked and bookmarked.
 *
 * ⚠ `history.replaceState`, NOT `router.replace`. `/decide` runs three
 * corpus-wide document passes and a portfolio match per staged session on every
 * render, so a Next navigation per keystroke would make the search unusable and
 * every chip press cost a second. `LeadsClient` took the same decision for the
 * same reason and wrote down why; this is that helper's sibling, not a new idea.
 *
 * Module scope rather than the component body: it needs nothing but its
 * arguments, and a helper defined in the body destabilises what it is passed to
 * (§12).
 */
function syncViewToUrl(sort: DecideSort, kind: DecideKind | 'all', query: string): void {
  const url = new URL(window.location.href)
  const set = (key: string, value: string, isDefault: boolean) => {
    if (isDefault) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  // A default is ABSENT, never spelled out: `/decide` and
  // `/decide?sort=consequence&kind=all` must not be two different-looking links
  // to the same view.
  set('sort', sort, sort === 'consequence')
  set('kind', kind, kind === 'all')
  set('q', query, query.trim() === '')
  window.history.replaceState(null, '', url)
}

export default function DecideClient({
  items,
  records,
  initialSort = 'consequence',
  initialKind = null,
  initialQuery = '',
}: {
  items: DecideItem[]
  /** From ?sort= — already narrowed on the server, so the first paint is right. */
  initialSort?: DecideSort
  /** From ?kind= — an unknown value falls back to "Everything". */
  initialKind?: string | null
  /** From ?q= — a linked search. */
  initialQuery?: string
  /**
   * Every project and opportunity a row can be filed onto by hand.
   *
   * Passed down rather than fetched: it is the same list the matcher proposes
   * from, already filtered for this reader's confidential projects on the
   * server (§8). A picker that queried for itself would be a second definition
   * of "what records are there", and the one that leaks is always the second.
   */
  records: PickableRecord[]
}) {
  const router = useRouter()
  /*
    The kind chip, seeded from the URL.

    ⚠ VALIDATED AGAINST `KIND_META`, NOT CAST. `?kind=` is user input, and a
    typo'd value would filter the list to nothing while every chip rendered
    unselected — a page that looks empty for no visible reason.
  */
  const [kind, setKind] = useState<DecideKind | 'all'>(() =>
    initialKind && initialKind in KIND_META ? (initialKind as DecideKind) : 'all'
  )
  /** Which of the four orders the list is in. See DECIDE_SORTS. */
  const [sort, setSort] = useState<DecideSort>(() => asDecideSort(initialSort))
  /*
    The free-text filter.

    ⚠ WHY A QUEUE OF A HUNDRED NEEDS ONE AT ALL: the rows are ranked by
    consequence, not grouped by deal, so the four things waiting on Steelton
    are scattered through the list by design — and the reader arriving with a
    deal in mind had no way to gather them. The kind chips answer "what sort of
    decision"; this answers "which deal", which is the question somebody
    actually walks up with.

    ⚠ ANY WORD, IN ANY ORDER, NOT THE PHRASE (§12 — a keyword search that only
    matches the whole phrase answers "nothing" where it means "not adjacent").
    `cleveland steelton` must find "Steelton — Cleveland-Cliffs (PA)".
  */
  const [query, setQuery] = useState(initialQuery)
  /**
   * The row whose record is being chosen by hand, and which verb will run.
   *
   * Two steps rather than one dialog per verb: the reader picks the deal, then
   * says what to do with it, because on a staged conversation those are
   * genuinely different decisions over the same record ("file the whole
   * conversation onto Steelton" vs "put its three follow-ups on Steelton's
   * board") and a row with four buttons had already stopped being readable.
   */
  const [picking, setPicking] = useState<{ item: Dated; record: PickableRecord | null } | null>(
    null
  )
  /** A rescrub in flight, and what the last one found. */
  const [rescrubbing, setRescrubbing] = useState(false)
  // Set aside in this session. Optimistic: the row goes immediately and comes
  // back if the write fails, because a queue that pauses on every dismissal is
  // one nobody clears.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<string | null>(null)
  /**
   * The row being confirmed, AND which of its answers.
   *
   * ⚠ IT USED TO BE THE ROW ALONE, which was fine while a row had exactly one
   * Accept. Now a staged conversation can become a record OR a task on a deal,
   * so the dialog has to know which was pressed — a confirm that read the
   * primary action off the row would have asked about creating a project and
   * then created a task.
   */
  const [asking, setAsking] = useState<{
    item: Dated
    action: AcceptAction
    name: string | null
    /**
     * The record a person CHOSE, where they chose one.
     *
     * Absent means the row's own computed destination, which is every
     * pre-existing path. Carried through the dialog rather than stashed on the
     * row, so the confirmation sentence and the write can never name different
     * deals — the bug the `asking` shape was widened for in the first place.
     */
    target?: PickableRecord
  } | null>(null)
  // Rows ticked for a batch accept, keyed `kind:id` like everything else here.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [askingBatch, setAskingBatch] = useState(false)
  // Progress through a running batch. Null when none is running — a batch of
  // seventy takes long enough that a silent page would look frozen.
  const [bulk, setBulk] = useState<{
    total: number
    done: number
    failed: number
    label: string
  } | null>(null)
  // Captured once at mount rather than read during render: a clock read while
  // rendering is impure, and the list must not silently reorder itself between
  // two renders of the same data.
  const [now] = useState(() => Date.now())
  /*
    The keyboard cursor — an index into `visible`.

    -1 until a key is pressed, so a mouse user never sees a highlighted row
    they did not ask for. The queue is the one surface in the app worked in
    batches of seventy, and it was reachable only by mouse: j/k to move, x to
    tick, a to accept, Enter to open.
  */
  const [cursor, setCursor] = useState(-1)
  const rowsRef = useRef(new Map<number, HTMLDivElement | null>())
  /*
    Anchor for a shift-click range, as a ref rather than state: it changes on
    every tick and nothing renders from it, so it must not cost a render.
  */
  const anchorRef = useRef<number | null>(null)

  const ranked = useMemo(
    () =>
      items
        .map((i) => ({
          ...i,
          daysLeft: daysUntil(i.deadline, now),
          // Money breaks ties inside a band — see decideWeight.
          value: i.facts?.value ?? null,
          // A staged meeting has no deadline; its lift comes from how recent it
          // is, so the call from yesterday leads the ones from last week.
          boost: i.occurredAt ? meetingBoost(i.occurredAt, now) : undefined,
          /*
            Whether this row can be settled without opening it — the key the
            `quick` order reads.

            ⚠ DERIVED HERE, FROM THE SAME TWO FIELDS THE BUTTON READS. A second
            definition of "clearable" beside the one the row renders from is
            §12's one-quantity-two-definitions: the order would promise a button
            that the row then declines to draw.
          */
          clearable: Boolean(i.accept) && !i.blocker,
        }))
        .sort(decideComparator(sort)),
    [items, now, sort]
  )
  const live = useMemo(
    () => ranked.filter((i) => !dismissed.has(`${i.kind}:${i.id}`)),
    [ranked, dismissed]
  )
  /*
    The search, applied BEFORE the kind chips — which is what makes their counts
    true.

    ⚠ ORDER IS THE WHOLE POINT. Counting the chips over `live` and then
    filtering the rows would put "Correspondence 4" above a list showing one,
    which is §12's three-numbers-for-one-quantity on a single screen. One
    population, counted and shown.
  */
  const found = useMemo(
    () =>
      filterByWords(live, query, (i) =>
        /*
          What a row is searchable BY. The deal each button would file onto is
          in here on purpose: "steelton" must find the conversation whose only
          mention of Steelton is the name on its Accept button, which is
          precisely the row somebody searching for Steelton wants.
        */
        [i.title, i.subtitle, i.note, i.acceptName, i.altAccept?.name].filter(Boolean).join(' ')
      ),
    [live, query]
  )
  const visible = useMemo(
    () => (kind === 'all' ? found : found.filter((i) => i.kind === kind)),
    [found, kind]
  )

  const counts = useMemo(() => {
    /*
      ⚠ SEEDED FROM `KIND_META`, NOT FROM A HAND-WRITTEN LIST. The zero map
      named lead/intake/review while `DecideKind` had more members, so
      `c['document']` was undefined and `undefined++` is NaN: the live queue
      rendered a chip reading "Unfiled document NaN", and a kind added later
      showed no count at all. A counter map beside a registry must be built
      from the registry's own keys, or the next kind added repeats it.
    */
    const c: Record<string, number> = { all: found.length }
    for (const k of Object.keys(KIND_META)) c[k] = 0
    for (const i of found) c[i.kind]++
    return c
  }, [found])

  /** Only a row that can actually be accepted from the list can be ticked. */
  const selectable = useMemo(() => visible.filter((i) => i.accept), [visible])
  const selectedItems = useMemo(
    () => live.filter((i) => selected.has(`${i.kind}:${i.id}`) && i.accept),
    [live, selected]
  )

  /**
   * The rows the machine already decided on and was confident about.
   *
   * ⚠ Measured on 2026-09-24, not guessed: of 81 staged sessions, 75 were
   * `create` and 6 `merge`, NONE said dismiss, and EVERY ONE scored at or above
   * this threshold (average 0.93). 77 of them were accept-ready; the other four
   * are the known sessions whose correspondence never states a record name. The
   * oldest had been waiting since 12 July.
   *
   * So on today's data the threshold selects everything, which is the honest
   * situation rather than a reason to drop it: it is what keeps a future batch
   * from sweeping up a session the model was unsure about, and the reader still
   * sees every row it ticked before confirming.
   */
  const confident = useMemo(
    () => selectable.filter((i) => (i.confidence ?? 0) >= 0.85),
    [selectable]
  )

  /**
   * Whether every acceptable row CURRENTLY SHOWN is ticked.
   *
   * Compared row by row rather than by count: selection survives a filter
   * change (deliberately — you can gather a batch across tabs), so comparing
   * `selected.size` against the visible total says "Clear" as soon as the two
   * numbers happen to coincide, on a tab where nothing is ticked at all.
   */
  const allShownSelected =
    selectable.length > 0 && selectable.every((i) => selected.has(`${i.kind}:${i.id}`))

  /**
   * Tick one row, or — with shift held — everything from the last tick to here.
   *
   * The anchor is the row ticked last, mail-client style, and a range only
   * ADDS: a shift-click that could silently clear thirty rows the reader had
   * gathered is not worth the symmetry. Rows the batch would refuse are
   * skipped rather than counted, so the number beside Accept stays the number
   * of records that will actually be written.
   */
  const pick = useCallback((index: number, shift: boolean) => {
    const item = visible[index]
    if (!item?.accept) return
    if (shift && anchorRef.current !== null) {
      const from = Math.min(anchorRef.current, index)
      const to = Math.max(anchorRef.current, index)
      setSelected((prev) => {
        const next = new Set(prev)
        for (let i = from; i <= to; i++) {
          const row = visible[i]
          if (row?.accept) next.add(`${row.kind}:${row.id}`)
        }
        return next
      })
    } else {
      const key = `${item.kind}:${item.id}`
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }
    anchorRef.current = index
  }, [visible])

  /**
   * TELL THE SERVER SOMETHING CHANGED — ONCE, AFTER THE LAST WRITE.
   *
   * ⚠ WITHOUT THIS THE NUMBERS LIE FOR AS LONG AS THE TAB STAYS OPEN, and that
   * is not a cosmetic complaint: on 2026-10-20 Richard cleared 119 sessions in
   * one sitting and the sidebar still read 248, because every dismissal here is
   * optimistic LOCAL state and the badge is server-rendered in the root layout
   * — which App Router reuses across soft navigations. The database said 1. He
   * reasonably read the unchanged number as the work not having taken, and
   * asked whether dismissing was the wrong verb. It was not; nothing had told
   * the server to re-render.
   *
   * Debounced rather than per-row: a clearing session is a hundred writes, and
   * a hundred refreshes would re-run `countDecideItems`, `computeAttention` and
   * every sidebar count a hundred times against a box that serves one model
   * request at a time. The trailing edge is the only one that matters — the
   * count is only interesting once the reader stops.
   */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      router.refresh()
    }, 1500)
  }, [router])
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    },
    []
  )

  async function dismiss(item: Dated) {
    const key = `${item.kind}:${item.id}`
    const spec = DISMISS[item.kind]
    // A kind with no dismiss path renders no button, so this is unreachable.
    // Guarded anyway rather than asserted: the cost of being wrong is a row
    // that disappears from the reader's list without anything being written.
    if (!spec) return
    setPending(key)
    setDismissed((prev) => new Set(prev).add(key))
    try {
      const res = await fetch(spec.url(item.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec.body(item)),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Failed (${res.status})`)
      }
      toast.success(spec.verb, { description: item.title })
      scheduleRefresh()
    } catch (err) {
      // Put it back: a row that vanished without being written is worse than
      // one that never moved, because the reader believes it was handled.
      setDismissed((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      toast.error(err instanceof Error ? err.message : 'Could not set that aside')
    } finally {
      setPending(null)
    }
  }

  /**
   * The write behind an accept. Throws on failure so both the single-row path
   * and the batch can decide for themselves what to say about it.
   */
  /**
   * Carry out the write a row's press means.
   *
   * ⚠ THE CHOICE OF WRITE IS NOT MADE HERE ANY MORE — `planAccept` makes it, in
   * `src/lib/decide/accept-request.ts`, where it is a pure function a test can
   * walk every kind of. It lived here as an `if/else if` chain whose final arm
   * was the review route, and `unparented` fell into it: 120 rows whose Accept
   * button PATCHed `/api/review/<a document's uuid>` and answered
   * `404 Review item not found`, green through typecheck, build and the suite.
   *
   * Throws on failure so both the single-row path and the batch can decide for
   * themselves what to say about it.
   */
  async function performAccept(
    item: Dated,
    action: AcceptAction | null = item.accept,
    /**
     * The record a person chose, overriding whatever the row would resolve.
     *
     * ⚠ PASSED TO THE ROUTE, NEVER APPLIED HERE. Each route re-reads the record
     * before writing to it, so a deal deleted between the page render and the
     * press is a refusal rather than a conversation filed at a dangling id —
     * which is the one outcome that looks exactly like success.
     */
    target?: PickableRecord
  ) {
    if (!action) return
    const plan = planAccept(item, action, target)
    if (plan.kind === 'refused') throw new Error(plan.reason)
    if (plan.kind === 'draft-then-confirm') {
      // Fetched rather than reconstructed here: the draft is built from the
      // full extraction by the same function the review form uses, so the two
      // paths cannot produce different records.
      const draft = await getJson(plan.draftUrl)
      await post(plan.confirmUrl, (draft as { body: unknown }).body)
      return
    }
    if (plan.method === 'PATCH') await patch(plan.url, plan.body)
    else await post(plan.url, plan.body)
  }

  /**
   * Carry out an accept. Optimistic like dismiss, and reverted the same way —
   * but the toast names what was created, because a row that simply disappears
   * gives no evidence that a record now exists somewhere.
   */
  async function accept(
    item: Dated,
    action: AcceptAction | null = item.accept,
    name: string | null = null,
    target?: PickableRecord
  ) {
    if (!action) return
    const key = `${item.kind}:${item.id}`
    const copy = ACCEPT_COPY[action]
    setPending(key)
    try {
      await performAccept(item, action, target)
      setDismissed((prev) => new Set(prev).add(key))
      toast.success(copy.done, { description: name ?? item.acceptName ?? item.title })
      scheduleRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not accept that')
    } finally {
      setPending(null)
      setAsking(null)
    }
  }

  /**
   * A press on any accept button. THE one door.
   *
   * ⚠ EVERY CALL SITE GOES THROUGH THIS, which is the point. There were four
   * places that opened the confirmation — the primary button, the alternate,
   * the record picker and the `a` keyboard shortcut — and four places is
   * exactly where a policy written as an `if` at each one drifts (§12). The
   * decision lives in `CONFIRM_BEFORE` and nothing else may read it.
   *
   * A confirming action opens the dialog as before. Everything else fires
   * immediately: `accept` is already optimistic, so the row leaves the list on
   * the press and comes back if the write fails.
   */
  function requestAccept(
    item: Dated,
    action: AcceptAction,
    name: string | null,
    target?: PickableRecord
  ) {
    if (CONFIRM_BEFORE[action]) {
      setAsking({ item, action, name, target })
      return
    }
    void accept(item, action, name, target)
  }

  /*
    The same function, reachable from the keydown listener without being one of
    its dependencies.

    ⚠ A REF RATHER THAN A DEPENDENCY, AND BOTH ALTERNATIVES WERE WORSE. Listing
    `requestAccept` in the effect's deps re-registers the window listener on
    every render, because it is a fresh closure each time — correct, and it
    earned a lint warning saying so. Omitting it captures a STALE closure, which
    on this queue means `a` acting on the row the cursor was on two renders ago.
    Wrapping it in `useCallback` only moves the problem: it closes over `accept`,
    which closes over `performAccept` and three setters, so the whole chain would
    have to become callbacks inside an 1,800-line component.

    The ref is updated in an effect, never during render — an assignment during
    render is impure, which is the other rule the linter here enforces (§9
    names `react-hooks/purity` as one of the three standing exemptions, and
    this is how not to add a fourth).
  */
  const requestAcceptRef = useRef(requestAccept)
  useEffect(() => {
    requestAcceptRef.current = requestAccept
  })

  /**
   * Ask Ber AI to look again at where every staged conversation belongs.
   *
   * ⚠ IT CHANGES A RECOMMENDATION, NOT A RECORD. The pass behind this re-reads
   * each pending session against the WHOLE portfolio as it stands today —
   * which is what the matcher that produced these rows could not do, because
   * its candidate list was frozen when the correspondence was staged and every
   * record created since is invisible to it. Measured on the live queue
   * 2026-10-28: a thread labelled `GridEdgeDC` carried Heber Development and
   * Myton Development at 0.38, against an opportunity named **GridEdge**.
   *
   * Nothing is created, filed, confirmed or dismissed — the rows come back
   * with better buttons on them and the press is still yours. See
   * src/lib/decide/rescrub.ts.
   */
  async function rescrub() {
    setRescrubbing(true)
    try {
      const res = await fetch('/api/decide/rescrub', { method: 'POST' })
      if (!res.ok) await readError(res)
      const p = (await res.json()) as {
        examined: number
        placed: number
        unplaced: number
        unchanged: number
        changes: Array<{ label: string; record: string }>
      }
      if (p.placed > 0) {
        toast.success(
          `${p.placed} now ${p.placed === 1 ? 'points' : 'point'} at a deal you already have`,
          {
            description: p.changes
              .slice(0, 3)
              .map((c) => `${c.label} → ${c.record}`)
              .join(' · '),
          }
        )
        // Immediate, not debounced: the whole point of the press is to see the
        // buttons change, and there is exactly one write to wait for.
        router.refresh()
      } else if (p.examined === 0) {
        toast.info('Nothing staged to re-check', {
          description: 'Only staged correspondence is re-asked — documents are matched fresh on every load.',
        })
      } else {
        toast.info(`Re-read ${p.examined}, nothing moved`, {
          description:
            p.unchanged > 0
              ? `${p.unchanged} already named the right deal; ${p.unplaced} match no record we have.`
              : `None of them matches a record we already have.`,
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not re-check the queue')
    } finally {
      setRescrubbing(false)
    }
  }

  /**
   * Accept everything selected, ONE AT A TIME.
   *
   * ⚠ Sequential on purpose, and it is not a UI preference. Each accept writes
   * a record with its people, tasks and attachments, publishes documents to
   * Drive, and on this box shares one local model that serves a single request
   * at a time. Firing seventy of those at once queues them behind each other
   * with seventy open transactions and no way to say which one failed.
   *
   * A failure does NOT stop the run — the rest of the batch is still good work,
   * and the failed rows stay in the queue where they can be looked at one by
   * one. What must never happen is a row vanishing without being written, so
   * only rows that actually succeeded are marked done.
   */
  async function acceptSelected(batch: Dated[]) {
    setAskingBatch(false)
    setBulk({ total: batch.length, done: 0, failed: 0, label: batch[0]?.title ?? '' })
    let done = 0
    let failed = 0
    const failures: string[] = []

    for (const item of batch) {
      setBulk({ total: batch.length, done, failed, label: item.title })
      try {
        await performAccept(item)
        done++
        const key = `${item.kind}:${item.id}`
        setDismissed((prev) => new Set(prev).add(key))
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      } catch (err) {
        failed++
        failures.push(`${item.title}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }

    setBulk(null)
    // One refresh for the batch, whatever the mix of outcomes: even an
    // all-failed run may have moved rows, and the reader is about to read a
    // count either way.
    if (done > 0) scheduleRefresh()
    if (failed === 0) {
      toast.success(`${done} accepted`, { description: 'Records created and filed.' })
    } else {
      toast.warning(`${done} accepted, ${failed} could not be`, {
        description: `${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`,
      })
    }
  }

  /*
    Clamped at read time rather than corrected in an effect — the same rule the
    command palette uses. The list shrinks under the cursor as rows are
    accepted and set aside, and an index past the end must neither throw nor
    silently jump back to the top of a queue the reader was halfway down.
  */
  const cursorIdx = visible.length === 0 ? -1 : Math.min(cursor, visible.length - 1)
  const cursorItem = cursorIdx >= 0 ? visible[cursorIdx] : undefined

  /*
    The keyboard.

    Deliberately NOT active while a batch is running or a confirmation is open:
    a key that queues another write behind seventy in flight, or that answers a
    dialog the reader has not read, is worse than no shortcut. Modifier
    combinations fall through untouched so the global ⌘K and ⌘J still work, and
    so do keys typed into a field.
  */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (bulk || asking || askingBatch || picking) return
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return
      }
      const last = visible.length - 1
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          setCursor((c) => Math.min(c < 0 ? 0 : c + 1, last))
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          setCursor((c) => (c <= 0 ? 0 : c - 1))
          break
        case 'x':
        case ' ':
          if (cursorIdx < 0) return
          e.preventDefault()
          pick(cursorIdx, e.shiftKey)
          break
        case 'a':
          if (!cursorItem?.accept) return
          e.preventDefault()
          /*
            ⚠ THROUGH `requestAccept`, WHICH IS WHAT KEEPS THE OLD GUARANTEE
            HERE. This read "through the confirmation, never straight to the
            write: a mistyped key must not create a project" — true while every
            action confirmed, and no longer a description of this line now that
            most of them do not (10-30). The guarantee survives because the
            policy moved rather than loosened: `CONFIRM_BEFORE` still marks
            project and opportunity, so a mistyped `a` on one of those rows
            opens the dialog exactly as before. On a reversible row it now
            fires, which is the point — the queue is worked with j/k/a and a
            dialog between every press was the thing being asked about.

            ⚠ ALWAYS THE PRIMARY ACTION. The alternate is deliberately not
            bound to a key — one keystroke that does one of two different
            things depending on the row is how a task lands where a record was
            meant, and the shortcut overlay could not state it honestly.
          */
          requestAcceptRef.current(cursorItem, cursorItem.accept, cursorItem.acceptName ?? null)
          break
        case 'Enter':
          if (!cursorItem) return
          e.preventDefault()
          router.push(cursorItem.href)
          break
        case 'Escape':
          // One rule rather than two: Escape clears the selection AND the
          // cursor. A key that means different things depending on hidden
          // state is one nobody trusts on a queue of seventy.
          setSelected(new Set())
          setCursor(-1)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // `requestAcceptRef` is a ref, so it is deliberately not a dependency —
    // see the note on its declaration for why that is the right call here and
    // not the stale-closure bug it usually is.
  }, [visible, cursorIdx, cursorItem, bulk, asking, askingBatch, picking, pick, router])

  // Keep the cursor row on screen. `block: 'nearest'` scrolls the minimum —
  // the row the reader is already looking at must not jump to the middle.
  useEffect(() => {
    if (cursorIdx < 0) return
    rowsRef.current.get(cursorIdx)?.scrollIntoView({ block: 'nearest' })
  }, [cursorIdx])

  /*
    Mirror the view into the address bar.

    In an effect rather than inside each setter, so the three controls cannot
    drift into three slightly different serialisations of the same view — and so
    a change made any other way (the "Clear" affordance, a future saved view)
    is carried without being remembered about. See syncViewToUrl for why this is
    `replaceState` and not a navigation.
  */
  useEffect(() => {
    syncViewToUrl(sort, kind, query)
  }, [sort, kind, query])

  const urgent = live.filter((i) => i.daysLeft !== null && i.daysLeft <= 7).length

  if (live.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing waiting on you"
          description="Every staged conversation, document question and flagged extraction has been dealt with. Inbound bid invitations live on Leads."
        />
      </Panel>
    )
  }

  return (
    <div className="space-y-3">
      {/*
        Find a deal in the queue, and ask Ber AI to look again.

        ⚠ THE SEARCH IS NOT A CONVENIENCE ON A QUEUE THAT IS RANKED. The rows
        are ordered by consequence, so everything waiting on one deal is
        scattered through the list on purpose — and the reader who arrives
        thinking "what is outstanding on Steelton" had to scroll 130 rows
        reading titles. The kind chips answer "what sort of decision"; this
        answers "which deal".
      */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a deal, a document, a person…"
            aria-label="Filter the queue"
            className="h-[2.75rem] w-full rounded-lg border border-input bg-card pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9"
          />
        </div>
        {/*
          ⚠ NOT A BATCH ACCEPT WEARING A DIFFERENT ICON. This writes no record
          and files nothing — it re-reads the staged conversations against the
          portfolio as it stands today and changes what their buttons SAY. The
          label has to carry that, or it reads as the one button on this page
          nobody should press without looking.
        */}
        <Button
          type="button"
          variant="outline"
          onClick={() => void rescrub()}
          disabled={rescrubbing || Boolean(bulk)}
          title="Re-read every staged conversation against the portfolio as it stands today. Nothing is created or filed — only the suggested deal changes."
          className="h-[2.75rem] sm:h-9"
        >
          {rescrubbing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {rescrubbing ? 'Re-checking…' : 'Re-check where these belong'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/*
          ⚠ DERIVED FROM `KIND_META`, NOT WRITTEN OUT. The note on `counts`
          above records this exact bug being fixed there — a kind-keyed
          structure beside the registry, missing the registry's newest key —
          and it was still written out HERE, one structure over. Adding
          'misfiled' gave it a count and no chip, so the rows existed in
          "Everything" and could not be filtered to. Reading order is
          KIND_META's declaration order, which is therefore the place to
          change it.
        */}
        {(['all', ...(Object.keys(KIND_META) as DecideKind[])] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`inline-flex items-center text-xs px-3 sm:px-2.5 min-h-[2.75rem] sm:min-h-0 sm:py-1 rounded-full ring-1 ring-inset transition-colors ${
              kind === k
                ? 'bg-primary text-primary-foreground ring-primary'
                : 'bg-card text-muted-foreground ring-border hover:bg-accent'
            }`}
          >
            {k === 'all' ? 'Everything' : KIND_META[k].label}
            <span className="ml-1.5 tnum opacity-70">{counts[k]}</span>
          </button>
        ))}
        {urgent > 0 && (
          <span className="ml-auto text-xs text-critical font-medium">
            {urgent} closing within a week
          </span>
        )}
      </div>

      {/*
        The order. Four views of ONE population — the chip counts above are
        deliberately unaffected by which is chosen, because a sort that changed
        the numbers would be a filter wearing a sort's clothes.

        ⚠ `Segmented`, NOT A FOURTH HAND-ROLLED PILL ROW. `SortControls` on the
        dashboard carries the note *"if a third of these appears, merge them"*;
        this is the third, so it uses the primitive and `SortControls` was moved
        onto it in the same change (§12 — a shared renderer wired to one surface
        is worse than no shared renderer).
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Sort</span>
        <Segmented
          value={sort}
          onChange={setSort}
          label="Sort the queue"
          options={DECIDE_SORTS}
        />
      </div>

      {/* The batch bar. Present whenever there is anything to batch, because a
          control that only appears once you have already started selecting is
          one nobody discovers — and the whole point is to offer the shortcut
          before the reader resigns themselves to clicking seventy times. */}
      {/* Sticky, because a control at the top of a list of 190 is a control
          you have to leave the rows to reach: the reader ticks on the way
          down, and Accept had scrolled off the screen by row twelve. */}
      {(selectable.length > 0 || bulk) && (
        <Panel className="sticky top-0 z-10 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {bulk ? (
            <>
              <Loader2 size={14} className="animate-spin text-primary shrink-0" />
              <span className="text-sm">
                Accepting {bulk.done + bulk.failed + 1} of {bulk.total}
                <span className="text-muted-foreground"> — {bulk.label}</span>
              </span>
              {bulk.failed > 0 && (
                <span className="text-xs text-caution tnum">
                  {bulk.failed} failed, continuing
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                {selected.size > 0
                  ? `${selectedItems.length} selected`
                  : `${selectable.length} of ${visible.length} can be accepted without opening them`}
              </span>
              <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                {confident.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(new Set(confident.map((i) => `${i.kind}:${i.id}`)))
                    }
                    className="inline-flex items-center h-[2.75rem] sm:h-7 px-3.5 sm:px-2.5 rounded-lg text-sm font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
                  >
                    Select {confident.length} high-confidence
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      for (const i of selectable) {
                        const key = `${i.kind}:${i.id}`
                        if (allShownSelected) next.delete(key)
                        else next.add(key)
                      }
                      return next
                    })
                  }
                  className="inline-flex items-center h-[2.75rem] sm:h-7 px-3.5 sm:px-2.5 rounded-lg text-sm font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
                >
                  {allShownSelected ? 'Clear shown' : 'Select all shown'}
                </button>
                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={() => setAskingBatch(true)}
                  className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-7 px-3.5 sm:px-2.5 rounded-lg text-sm font-medium bg-primary elev-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  <CheckCheck size={13} />
                  Accept {selectedItems.length > 0 ? selectedItems.length : ''}
                </button>
              </div>
            </>
          )}
        </Panel>
      )}

      {/* The shortcuts, stated rather than discovered — and only where there
          is a keyboard to press them with. */}
      {selectable.length > 0 && !bulk && (
        <p className="hidden sm:flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <span><Kbd>j</Kbd> <Kbd>k</Kbd> move</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>x</Kbd> select</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>shift</Kbd>+click a range</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>a</Kbd> accept</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>↵</Kbd> open</span>
          <span aria-hidden className="opacity-40">·</span>
          <span><Kbd>esc</Kbd> clear</span>
        </p>
      )}

      <Panel className="divide-y divide-border">
        {/*
          ⚠ AN EMPTY RESULT MUST SAY WHY AND OFFER THE WAY BACK. A filtered
          list rendering as an empty panel is indistinguishable from a cleared
          queue, and on this page those two readings are opposites.
        */}
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing here matches{query.trim() ? ` “${query.trim()}”` : ' that filter'}.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setKind('all')
              }}
              className="mt-2 text-sm font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Show all {live.length}
            </button>
          </div>
        )}
        {visible.map((item, index) => {
          const meta = KIND_META[item.kind]
          const Icon = meta.icon
          const overdue = item.daysLeft !== null && item.daysLeft < 0
          const soon = item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 7
          return (
            <div
              key={`${item.kind}:${item.id}`}
              ref={(el) => {
                rowsRef.current.set(index, el)
              }}
              /*
                ⚠ `py-2.5`, NOT `py-3`, AND THE NOTE IS ALWAYS ONE LINE.
                Measured 2026-10-27: 125 of 133 rows rendered at **88px**, so
                **9.3 of 136 items fit above the fold** on a 815px viewport —
                a queue whose whole job is to be worked through, showing 7% of
                itself. The two-line note was the bulk of it.
                A row with no facts strip used to keep two lines of the
                model's prose; it now keeps one like every other row, and the
                full text rides in `title` for a hover and is one click away
                in the record itself. That is the honest version of the
                audit's "truncate with hover-expand" — a hover-only expansion
                does not exist on a phone (§12), so the information has to be
                reachable another way, and it is.
              */
              /*
                ⚠ `flex-wrap`, BECAUSE THE BUTTONS NAME DEALS AND DEAL NAMES ARE
                LONG. Measured at 820px on 2026-10-28: a row offering
                "File onto Deseret / Bonanza Power Generation",
                "Task on Deseret / Bonanza Power Generation" and "Choose a
                deal" ran straight out of the panel and printed ON TOP of its
                own title — the action group was `shrink-0`, so there was
                nothing in the row that could give. Wrapping lets it drop to a
                second line instead; `basis-[18rem]` on the content is what
                decides when. The labels are capped as well (see the spans), so
                one very long name cannot widen the group past the panel on its
                own.
              */
              className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-2.5 compact:py-1.5 transition-colors group ${
                index === cursorIdx
                  ? 'bg-accent ring-1 ring-inset ring-primary/40'
                  : 'hover:bg-accent'
              }`}
            >
              {/* Only acceptable rows get a tick box. A checkbox that selects
                  something the batch would then refuse is a promise the list
                  cannot keep, so a blocked row keeps its icon and its reason. */}
              {item.accept ? (
                <label className="relative mt-0.5 shrink-0 inline-flex items-center justify-center cursor-pointer">
                  {/* The 44px hit area, as an overlay rather than padding —
                      padding here shifts the row under the next tap.
                      ⚠ THIS COMMENT USED TO BE FALSE. It said "44px" above a
                      `size-3.5` input with `-inset-3`: 14px plus 12px either
                      side is 38px. `tap-target` derives nothing from the
                      control's size, so the number and the class now agree. */}
                  <span className="tap-target" aria-hidden />
                  {/* The handler is onClick, not onChange, because only the
                      click event carries `shiftKey` — and a keyboard Space on
                      a checkbox dispatches a click too, so both routes land
                      here. onChange stays as a no-op for React's controlled
                      input contract. */}
                  <input
                    type="checkbox"
                    checked={selected.has(`${item.kind}:${item.id}`)}
                    onClick={(e) => {
                      setCursor(index)
                      pick(index, e.shiftKey)
                    }}
                    onChange={() => {}}
                    disabled={Boolean(bulk)}
                    aria-label={`Select: ${item.title}`}
                    className="relative size-3.5 accent-primary cursor-pointer disabled:opacity-40"
                  />
                </label>
              ) : (
                <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              )}
              {/* The row's own link. The dismiss control is a SIBLING, never
                  nested — a button inside an anchor is invalid markup and
                  hydrates badly. */}
              <Link href={item.href} className="min-w-0 flex-1 basis-[18rem]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{item.title}</span>
                  {item.verdict && (
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${
                        VERDICT_TONE[item.verdict] ?? VERDICT_TONE.consider
                      }`}
                    >
                      {VERDICT_LABEL[item.verdict] ?? enumLabel(item.verdict)}
                    </span>
                  )}
                  {item.deadline && (
                    <span
                      className={`text-[11px] font-medium tnum ${
                        overdue || soon
                          ? 'text-critical'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {overdue
                        ? `closed ${Math.abs(item.daysLeft!)}d ago`
                        : item.daysLeft === 0
                          ? 'due today'
                          : `due in ${item.daysLeft}d`}
                    </span>
                  )}
                </div>
                {item.subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>
                )}
                {factStrip(item.facts).length > 0 && (
                  <p className="text-xs text-foreground/80 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    {factStrip(item.facts).map((f, i) => (
                      <span key={f.key} className="inline-flex items-center gap-1.5">
                        {i > 0 && <span className="text-muted-foreground/40" aria-hidden>·</span>}
                        <span className={f.strong ? 'font-medium tnum' : undefined}>{f.text}</span>
                      </span>
                    ))}
                  </p>
                )}
                {/* Prose is the FALLBACK, not the row — one line of the
                    model's reasoning, with the whole of it in `title`. */}
                {/*
                  ⚠ `compact:hidden` IS WHAT MAKES 64px REACHABLE, and why it
                  is a CHOICE. This line is the model's reasoning, and it is
                  what makes the banner above the list ("138 of 140 can be
                  accepted without opening them") a defensible offer rather
                  than a leap. Hiding it by default would quietly trade the
                  queue's safety for nine more rows; hiding it on request is
                  a reader who has decided they already trust it. The whole
                  text stays in `title` either way.
                */}
                {item.note && (
                  <p className="mt-0.5 line-clamp-1 compact:hidden text-xs text-muted-foreground/90" title={item.note}>
                    {item.note}
                  </p>
                )}
              </Link>
              <div className="flex items-center gap-1 mt-0.5 ml-auto shrink-0">
                {item.accept ? (
                  /*
                    ⚠ WAS `bg-primary elev-1/10 text-primary` AND THEREFORE
                    INVISIBLE. The `/10` belonged to `bg-primary` and landed on
                    `elev-1`, which Tailwind does not generate — so the fill
                    stayed at FULL accent under accent-coloured ink. Rust on
                    rust, on the Accept button of all 136 rows, in both themes,
                    through a green typecheck and a green suite. Now
                    `variant="soft"`, which is what the string was spelling.
                  */
                  <Button
                    variant="soft"
                    size="xs"
                    type="button"
                    onClick={() => requestAccept(item, item.accept!, item.acceptName ?? null)}
                    disabled={pending === `${item.kind}:${item.id}`}
                    title={acceptVerb(item)}
                    className="h-[2.75rem] sm:h-7 px-3.5 sm:px-2 text-sm"
                  >
                    {pending === `${item.kind}:${item.id}` ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    <span className="hidden sm:inline max-w-[15rem] truncate">{acceptVerb(item)}</span>
                  </Button>
                ) : (
                  item.blocker && (
                    // Never an Accept that would 400. The row says what it
                    // needs and sends you to the one screen that can supply it.
                    // Not `hidden sm:block`. A blocked row on a phone showed no
                    // button and no reason — an inert row with nothing to say
                    // for itself. The reason is the whole point of the row.
                    <span
                      className="block max-w-[10rem] sm:max-w-[14rem] text-[11px] text-caution text-right leading-tight"
                      title={item.blocker}
                    >
                      {item.blocker}
                    </span>
                  )
                )}
                {/*
                  The row's SECOND answer, where it has one.
                  ⚠ QUIETER THAN THE PRIMARY AND NOT A TICK BOX. It is the
                  alternative, not a competing recommendation, and a batch that
                  mixed the two would do one thing to rows selected for the
                  other. Rendered AFTER the primary so the recommended answer is
                  the one nearest the reader's thumb.
                  ⚠ ALWAYS VISIBLE, never hover-only: §12 — a control that only
                  appears on hover does not exist on a phone.
                */}
                {item.altAccept && (
                  <button
                    type="button"
                    onClick={() =>
                      requestAccept(item, item.altAccept!.action, item.altAccept!.name)
                    }
                    disabled={pending === `${item.kind}:${item.id}`}
                    title={`${acceptVerb({ accept: item.altAccept.action, acceptName: item.altAccept.name })} — ${item.altAccept.count} follow-up${item.altAccept.count === 1 ? '' : 's'}, and nothing else is created`}
                    className="inline-flex items-center gap-1 h-[2.75rem] sm:h-7 px-3.5 sm:px-2 rounded-lg text-sm font-medium text-muted-foreground ring-1 ring-inset ring-border hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    <ListChecks size={13} />
                    <span className="hidden sm:inline max-w-[15rem] truncate">
                      {acceptVerb({ accept: item.altAccept.action, acceptName: item.altAccept.name })}
                      <span className="ml-1 tnum opacity-70">{item.altAccept.count}</span>
                    </span>
                  </button>
                )}
                {/*
                  The row's THIRD answer: name the deal yourself.

                  ⚠ THE ONE ANSWER THIS QUEUE COULD NOT GIVE (10-28, Richard's
                  direction: *"only giving me 'create project' when I should be
                  able to associate it to current project or opportunity"*).
                  Every destination on this page came from a matcher, so a row
                  the matcher could not place offered exactly one verb —
                  "Create project" — for a conversation that plainly belonged
                  to a deal two rows above it. A person's pick is an ASSERTION
                  and outranks the resolver (§12); it is not a looser bar, it
                  is a different kind of evidence.

                  ⚠ ONE BUTTON, NOT ONE PER VERB. A staged conversation can be
                  filed onto the chosen deal or have its follow-ups taken onto
                  it, which with the primary and the set-aside would have been
                  five controls on a 64px row. The verbs live in the dialog,
                  after the deal is chosen, which is also the order the
                  decision is actually made in.
                */}
                {(item.pickActions?.length ?? 0) > 0 && records.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicking({ item, record: null })}
                    disabled={pending === `${item.kind}:${item.id}` || Boolean(bulk)}
                    title="Choose the project or opportunity this belongs to"
                    aria-label={`Choose the deal for: ${item.title}`}
                    className="inline-flex items-center gap-1 h-[2.75rem] sm:h-7 px-3.5 sm:px-2 rounded-lg text-sm font-medium text-muted-foreground ring-1 ring-inset ring-border hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    <Link2 size={13} />
                    <span className="hidden sm:inline">Choose a deal</span>
                  </button>
                )}
                <ArrowRight
                  size={13}
                  className="hidden sm:block text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                />
                {/* No Set-aside button for a kind that has no reversible
                    dismiss path. Rendering a button that cannot do anything is
                    worse than rendering none: the reader clicks it, the row
                    appears to clear, and nothing was written down. */}
                {DISMISS[item.kind] ? (
                <button
                  type="button"
                  onClick={() => dismiss(item)}
                  disabled={pending === `${item.kind}:${item.id}`}
                  aria-label={`Set aside: ${item.title}`}
                  title="Set aside — reversible, nothing is deleted"
                  className="inline-flex items-center justify-center size-[2.75rem] sm:size-7 -my-1.5 sm:my-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-background sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-40"
                >
                  {pending === `${item.kind}:${item.id}` ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <X size={13} />
                  )}
                </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </Panel>

      {askingBatch && selectedItems.length > 0 && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAskingBatch(false)}
          title={`Accept ${selectedItems.length} items`}
          description={`Create the records for all ${selectedItems.length} selected items, with their people, tasks and attachments? They are written one at a time and anything that fails stays in the queue.`}
          confirmLabel={`Accept ${selectedItems.length}`}
          onConfirm={() => acceptSelected(selectedItems)}
        />
      )}

      {/*
        Choose the deal, then say what to do with it.

        Two steps in one dialog rather than two dialogs: the record is the
        decision, and the verb only becomes answerable once it is named. A row
        with one available verb still shows the second step — it names the deal
        back at the reader before anything is written, which is the whole
        reason a pick is safe to act on.
      */}
      {picking && (
        <Dialog open onOpenChange={(o) => !o && setPicking(null)}>
          {/* Wider than the default `sm:max-w-sm`: the content IS a list of
              record names, several of which run past forty characters, and a
              dialog that truncates every option is one you cannot choose from. */}
          <DialogContent showCloseButton={false} className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {picking.record ? `What should happen on ${picking.record.name}?` : 'Which deal is this?'}
              </DialogTitle>
              <DialogDescription>
                {picking.record
                  ? picking.item.title
                  : `Pick the project or opportunity “${picking.item.title}” belongs to. Nothing is created — it joins a record you already have.`}
              </DialogDescription>
            </DialogHeader>

            {picking.record === null ? (
              <RecordPicker
                options={records}
                autoFocus
                // Inline, or the list is clipped by the dialog's own
                // `overflow-y-auto` — see the prop's note.
                layout="inline"
                limit={12}
                onPick={(record) => setPicking((p) => (p ? { ...p, record } : p))}
              />
            ) : (
              <div className="space-y-2">
                {(picking.item.pickActions ?? []).map((action) => {
                  const name = picking.record!.name
                  return (
                    <button
                      key={action}
                      type="button"
                      onClick={() => {
                        const record = picking.record!
                        setPicking(null)
                        requestAccept(picking.item, action, name, record)
                      }}
                      className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="block text-sm font-medium">
                        {acceptVerb({ accept: action, acceptName: name })}
                        {action === 'task' && picking.item.taskCount
                          ? ` (${picking.item.taskCount})`
                          : ''}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {ACCEPT_COPY[action].ask(name)}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setPicking((p) => (p ? { ...p, record: null } : p))}
                  className="text-xs text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Choose a different deal
                </button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {asking && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={acceptVerb({ accept: asking.action, acceptName: asking.name })}
          description={ACCEPT_COPY[asking.action].ask(asking.name ?? asking.item.title)}
          confirmLabel={acceptVerb({ accept: asking.action, acceptName: asking.name })}
          onConfirm={() => accept(asking.item, asking.action, asking.name, asking.target)}
        />
      )}
    </div>
  )
}
