'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Inbox, ClipboardCheck, FileText, ArrowRight, X, Loader2, Check, CheckCheck, Calculator, HelpCircle, ListChecks, type LucideIcon } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Kbd } from '@/components/ui/kbd'
import EmptyState from '@/components/shared/EmptyState'
import { decideWeight, daysUntil, meetingBoost } from '@/lib/decide/rank'
import { enumLabel, formatValue, formatDate } from '@/lib/utils/constants'
import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export type DecideKind =
  | 'intake'
  | 'review'
  | 'document'
  | 'misfiled'
  | 'economics'
  | 'proposal'

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

/**
 * ⚠ Until now this queue could only DISMISS. Every "yes" meant leaving the
 * page, opening a form on another route — which dropped the recommendation on
 * the way in — and re-forming a judgement the model had already made. Measured
 * on 2026-09-23: 5 intake sessions confirmed ever against 136 decided, and
 * 0 leads promoted out of 1,268. The recommendations were good; agreeing with
 * one was just more expensive than ignoring it.
 *
 * ⚠ This does NOT create anything on its own — CLAUDE.md §11 is untouched.
 * The click IS the human review the invariant requires; what changed is where
 * the click lives. The review screens remain for when you want to edit first.
 */
export type AcceptAction =
  | 'project'
  | 'opportunity'
  | 'merge'
  /**
   * Make it a task on a deal we already have, and create nothing else.
   *
   * ⚠ THE MISSING MIDDLE OF THIS QUEUE (10-22). A staged call or thread offered
   * three answers — create a whole record, merge the conversation onto one, or
   * dismiss it — and the commonest real answer was none of them: *"that is not
   * a project, that is a task on Steelton."* Reaching it meant leaving the page
   * for /tasks and retyping what the extraction already held, which is the same
   * cost that got 5 sessions confirmed out of 136 before Accept existed at all.
   *
   * Legal under §11: the invariant is that mail must not become a record
   * WITHOUT human review, and the press IS the review. Nothing is created
   * unattended — the automatic path stays the one narrow `side='us'`
   * all-internal commitment exception, which is latched elsewhere.
   */
  | 'task'
  | 'approve'
  | 'file'
  | 'setaside'
  | 'confirmfield'

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
    tone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  },
  document: {
    label: 'Unfiled document',
    icon: FileText,
    tone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
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
  misfiled: {
    label: 'Wrong deal',
    icon: FileText,
    tone: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
  },
  economics: {
    label: 'Deal figures',
    icon: Calculator,
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
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
  pursue: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  create: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  consider: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700',
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
 * ⚠ PARTIAL, AND THE GAP IS DELIBERATE. An economics proposal cannot be set
 * aside from this list: it belongs to a deal, its figures are judged against
 * the model and the quote they came from, and "dismiss these 12 figures"
 * without reading them is not a decision anyone should be able to make from an
 * aggregate. A kind with no entry here renders no Set-aside button rather than
 * one that fails, which is why this is Partial rather than a fifth row that
 * points at nothing.
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
 * What each accept says before it happens, and what it says afterwards.
 *
 * Accept confirms once; dismiss does not. The asymmetry is the point — setting
 * something aside is reversible and creates nothing, while accepting writes a
 * record, contacts, tasks and documents, and publishes to Drive.
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
    verb: 'File on record',
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

export default function DecideClient({ items }: { items: DecideItem[] }) {
  const router = useRouter()
  const [kind, setKind] = useState<DecideKind | 'all'>('all')
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
        }))
        .sort((a, b) => decideWeight(b) - decideWeight(a)),
    [items, now]
  )
  const live = useMemo(
    () => ranked.filter((i) => !dismissed.has(`${i.kind}:${i.id}`)),
    [ranked, dismissed]
  )
  const visible = useMemo(
    () => (kind === 'all' ? live : live.filter((i) => i.kind === kind)),
    [live, kind]
  )

  const counts = useMemo(() => {
    /*
      ⚠ SEEDED FROM `KIND_META`, NOT FROM A HAND-WRITTEN LIST. The zero map
      named lead/intake/review while `DecideKind` has five members, so
      `c['document']` was undefined and `undefined++` is NaN: the live queue
      rendered a chip reading "Unfiled document NaN", and the economics chip
      showed no count at all. A counter map beside a registry must be built
      from the registry's own keys, or the next kind added repeats it.
    */
    const c: Record<string, number> = { all: live.length }
    for (const k of Object.keys(KIND_META)) c[k] = 0
    for (const i of live) c[i.kind]++
    return c
  }, [live])

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
  async function performAccept(item: Dated, action: AcceptAction | null = item.accept) {
    if (!action) return
    // ⚠ THE TASK BRANCH COMES FIRST AND IS NOT KIND-SPECIFIC. Both an email
    // package and a recorded meeting reach it, and the route resolves the deal
    // from the session the same way the row's primary action did — see
    // task-target.ts. Branching on `item.kind` here would have needed two
    // arms for one write (§12: every source that can reach a switch needs an
    // arm, not just the one being added today).
    if (action === 'task') {
      await post('/api/email-ingestion/tasks', { session_id: item.id })
    } else if (item.kind === 'intake' && action === 'merge') {
      await post('/api/email-ingestion/merge', { session_id: item.id })
    } else if (item.kind === 'intake') {
      // Fetched rather than reconstructed here: the draft is built from the
      // full extraction by the same function the review form uses, so the
      // two paths cannot produce different records.
      const draft = await getJson(`/api/email-ingestion/sessions/${item.id}`)
      await post('/api/email-ingestion/confirm', (draft as { body: unknown }).body)
    } else if (item.kind === 'document' || item.kind === 'misfiled') {
      if (action === 'setaside') {
        await post(`/api/documents/${item.id}/refile`, {
          exclude: true,
          reason: item.note,
          source: item.fileSource ?? 'documents',
        })
      } else if (item.fileTarget) {
        await post(`/api/documents/${item.id}/refile`, {
          target: item.fileTarget,
          source: item.fileSource ?? 'documents',
        })
      } else {
        // No target and not a set-aside is not a row that should have been
        // acceptable. Refuse loudly rather than silently doing nothing.
        throw new Error('This document has no record to file it on.')
      }
    } else if (item.kind === 'proposal') {
      await patch(`/api/provenance/proposals/${item.id}`, { verdict: 'accept' })
    } else {
      await patch(`/api/review/${item.id}`, { resolution: 'approved' })
    }
  }

  /**
   * Carry out an accept. Optimistic like dismiss, and reverted the same way —
   * but the toast names what was created, because a row that simply disappears
   * gives no evidence that a record now exists somewhere.
   */
  async function accept(item: Dated, action: AcceptAction | null = item.accept, name: string | null = null) {
    if (!action) return
    const key = `${item.kind}:${item.id}`
    const copy = ACCEPT_COPY[action]
    setPending(key)
    try {
      await performAccept(item, action)
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
      if (bulk || asking || askingBatch) return
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
          // Through the confirmation, never straight to the write: a mistyped
          // key must not create a project.
          //
          // ⚠ ALWAYS THE PRIMARY ACTION. The alternate is deliberately not
          // bound to a key — one keystroke that does one of two different
          // things depending on the row is how a task lands where a record was
          // meant, and the shortcut overlay could not state it honestly.
          setAsking({ item: cursorItem, action: cursorItem.accept, name: cursorItem.acceptName ?? null })
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
  }, [visible, cursorIdx, cursorItem, bulk, asking, askingBatch, pick, router])

  // Keep the cursor row on screen. `block: 'nearest'` scrolls the minimum —
  // the row the reader is already looking at must not jump to the middle.
  useEffect(() => {
    if (cursorIdx < 0) return
    rowsRef.current.get(cursorIdx)?.scrollIntoView({ block: 'nearest' })
  }, [cursorIdx])

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
          <span className="ml-auto text-xs text-red-600 dark:text-red-400 font-medium">
            {urgent} closing within a week
          </span>
        )}
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
                <span className="text-xs text-amber-700 dark:text-amber-400 tnum">
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
                    className="inline-flex items-center h-[2.75rem] sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
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
                  className="inline-flex items-center h-[2.75rem] sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
                >
                  {allShownSelected ? 'Clear shown' : 'Select all shown'}
                </button>
                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={() => setAskingBatch(true)}
                  className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
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
              className={`flex items-start gap-3 px-4 py-3 transition-colors group ${
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
                  {/* 44px hit area via an overlay, never padding — padding here
                      shifts the row under the next tap. */}
                  <span className="absolute -inset-3" aria-hidden />
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
              <Link href={item.href} className="min-w-0 flex-1">
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
                          ? 'text-red-600 dark:text-red-400'
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
                {/* Prose is the FALLBACK, not the row. A row with facts gets one
                    line of the model's reasoning; a row that has no facts to
                    show (review_queue carries none) keeps two. */}
                {item.note && (
                  <p
                    className={`text-xs text-muted-foreground/90 mt-1 ${
                      factStrip(item.facts).length > 0 ? 'line-clamp-1' : 'line-clamp-2'
                    }`}
                  >
                    {item.note}
                  </p>
                )}
              </Link>
              <div className="flex items-center gap-1 mt-0.5 shrink-0">
                {item.accept ? (
                  <button
                    type="button"
                    onClick={() => setAsking({ item, action: item.accept!, name: item.acceptName ?? null })}
                    disabled={pending === `${item.kind}:${item.id}`}
                    title={acceptVerb(item)}
                    className="inline-flex items-center gap-1 h-[2.75rem] sm:h-7 px-3 sm:px-2 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                  >
                    {pending === `${item.kind}:${item.id}` ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    <span className="hidden sm:inline">{acceptVerb(item)}</span>
                  </button>
                ) : (
                  item.blocker && (
                    // Never an Accept that would 400. The row says what it
                    // needs and sends you to the one screen that can supply it.
                    // Not `hidden sm:block`. A blocked row on a phone showed no
                    // button and no reason — an inert row with nothing to say
                    // for itself. The reason is the whole point of the row.
                    <span
                      className="block max-w-[10rem] sm:max-w-[14rem] text-[11px] text-amber-700 dark:text-amber-400 text-right leading-tight"
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
                      setAsking({
                        item,
                        action: item.altAccept!.action,
                        name: item.altAccept!.name,
                      })
                    }
                    disabled={pending === `${item.kind}:${item.id}`}
                    title={`${acceptVerb({ accept: item.altAccept.action, acceptName: item.altAccept.name })} — ${item.altAccept.count} follow-up${item.altAccept.count === 1 ? '' : 's'}, and nothing else is created`}
                    className="inline-flex items-center gap-1 h-[2.75rem] sm:h-7 px-3 sm:px-2 rounded-md text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border hover:bg-accent hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    <ListChecks size={13} />
                    <span className="hidden sm:inline">
                      {acceptVerb({ accept: item.altAccept.action, acceptName: item.altAccept.name })}
                      <span className="ml-1 tnum opacity-70">{item.altAccept.count}</span>
                    </span>
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

      {asking && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={acceptVerb({ accept: asking.action, acceptName: asking.name })}
          description={ACCEPT_COPY[asking.action].ask(asking.name ?? asking.item.title)}
          confirmLabel={acceptVerb({ accept: asking.action, acceptName: asking.name })}
          onConfirm={() => accept(asking.item, asking.action, asking.name)}
        />
      )}
    </div>
  )
}
