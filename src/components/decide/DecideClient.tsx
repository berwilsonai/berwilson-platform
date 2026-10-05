'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Radar, Inbox, ClipboardCheck, FileText, ArrowRight, X, Loader2, Check, CheckCheck, Calculator} from 'lucide-react'
import { Panel } from '@/components/ui/card'
import EmptyState from '@/components/shared/EmptyState'
import { decideWeight, daysUntil } from '@/lib/decide/rank'
import { enumLabel, formatValue, formatDate } from '@/lib/utils/constants'
import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export type DecideKind = 'lead' | 'intake' | 'review' | 'document' | 'economics'

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
  /** The record's name, so the confirmation can say what it will create. */
  acceptName?: string | null
  /**
   * Who a `handoff` goes to, in words — the lane's label ("Dino Plumbing").
   *
   * Server-supplied: the address itself never reaches the page, only the name
   * of the team it belongs to.
   */
  acceptTo?: string | null
  /**
   * Where a `file` accept sends the document.
   *
   * Carried on the row rather than re-derived in the client, for the same
   * reason `accept` is computed server-side: the browser never sees enough of
   * the portfolio to choose a record, and a filing decision that guessed would
   * be indistinguishable from one that knew.
   */
  fileTarget?: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string } | null
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
/**
 * `handoff` was `forward`, renamed when Dino became two lanes.
 *
 * The word matters at the reader: "Send to Dino" was accurate while Dino was
 * the only destination outside the platform, and became a lie the moment a
 * flooring lead could take the same exit. What the button now says is the lane's
 * own name, carried on the row as `acceptTo`.
 */
export type AcceptAction =
  | 'project'
  | 'opportunity'
  | 'merge'
  | 'steel'
  | 'handoff'
  | 'approve'
  | 'file'
  | 'setaside'

/** An item with its days-to-deadline resolved against a fixed clock. */
type Dated = DecideItem & { daysLeft: number | null }

const KIND_META: Record<DecideKind, { label: string; icon: typeof Radar; tone: string }> = {
  lead: {
    label: 'Inbound bid',
    icon: Radar,
    tone: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  },
  intake: {
    label: 'Correspondence',
    icon: Inbox,
    tone: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900',
  },
  document: {
    label: 'Unfiled document',
    icon: FileText,
    tone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  },
  economics: {
    label: 'Deal figures',
    icon: Calculator,
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  },
  review: {
    label: 'Needs a check',
    icon: ClipboardCheck,
    tone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
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
  Record<DecideKind, { url: (id: string) => string; body: unknown; verb: string }>
> = {
  lead: { url: (id) => `/api/leads/${id}`, body: { status: 'ignored' }, verb: 'Lead set aside' },
  intake: {
    url: (id) => `/api/email-ingestion/sessions/${id}`,
    body: {},
    verb: 'Correspondence dismissed',
  },
  review: {
    url: (id) => `/api/review/${id}`,
    body: { resolution: 'rejected' },
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
    body: { confirm: true },
    verb: 'Kept as company knowledge',
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
const ACCEPT_COPY: Record<AcceptAction, { verb: string; ask: (n: string) => string; done: string }> = {
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
  merge: {
    verb: 'Merge',
    ask: (n) => `File this correspondence onto “${n}”? Nothing new is created — the conversation and its attachments join the existing record.`,
    done: 'Filed onto the existing record',
  },
  steel: {
    verb: 'Add to Steel CRM',
    ask: (n) => `Create the steel deal “${n}” from this bid invitation?`,
    done: 'Steel deal created',
  },
  handoff: {
    verb: 'Hand off',
    ask: (n) => `Send “${n}” by email, with its attachments? The team that does this work has no access here, so this leaves the platform.`,
    done: 'Handed off',
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
 * A handoff names its destination — "Hand off to Dino Plumbing" — because the
 * row above it may hand off to somebody else entirely, and "Hand off" alone
 * would make three different exits look like one.
 */
function acceptVerb(item: { accept: AcceptAction | null; acceptTo?: string | null }): string {
  // Nullable rather than narrowed at each call site: every caller already sits
  // behind an `item.accept &&` guard, but the guard is on a property of an
  // object and TypeScript cannot narrow the object from it.
  if (!item.accept) return 'Accept'
  const base = ACCEPT_COPY[item.accept].verb
  return item.accept === 'handoff' && item.acceptTo ? `${base} to ${item.acceptTo}` : base
}

export default function DecideClient({ items }: { items: DecideItem[] }) {
  const [kind, setKind] = useState<DecideKind | 'all'>('all')
  // Set aside in this session. Optimistic: the row goes immediately and comes
  // back if the write fails, because a queue that pauses on every dismissal is
  // one nobody clears.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<string | null>(null)
  const [asking, setAsking] = useState<Dated | null>(null)
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

  const ranked = useMemo(
    () =>
      items
        .map((i) => ({
          ...i,
          daysLeft: daysUntil(i.deadline, now),
          // Money breaks ties inside a band — see decideWeight.
          value: i.facts?.value ?? null,
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
    const c: Record<string, number> = { all: live.length, lead: 0, intake: 0, review: 0 }
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

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
        body: JSON.stringify(spec.body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Failed (${res.status})`)
      }
      toast.success(spec.verb, { description: item.title })
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
  async function performAccept(item: Dated) {
    if (!item.accept) return
    if (item.kind === 'intake' && item.accept === 'merge') {
      await post('/api/email-ingestion/merge', { session_id: item.id })
    } else if (item.kind === 'intake') {
      // Fetched rather than reconstructed here: the draft is built from the
      // full extraction by the same function the review form uses, so the
      // two paths cannot produce different records.
      const draft = await getJson(`/api/email-ingestion/sessions/${item.id}`)
      await post('/api/email-ingestion/confirm', (draft as { body: unknown }).body)
    } else if (item.kind === 'lead') {
      if (item.accept === 'handoff') {
        await post(`/api/leads/${item.id}/handoff`, {})
      } else {
        await post(`/api/leads/${item.id}/promote`, { target: item.accept })
      }
    } else if (item.kind === 'document') {
      if (item.accept === 'setaside') {
        await post(`/api/documents/${item.id}/refile`, { exclude: true, reason: item.note })
      } else if (item.fileTarget) {
        await post(`/api/documents/${item.id}/refile`, { target: item.fileTarget })
      } else {
        // No target and not a set-aside is not a row that should have been
        // acceptable. Refuse loudly rather than silently doing nothing.
        throw new Error('This document has no record to file it on.')
      }
    } else {
      await patch(`/api/review/${item.id}`, { resolution: 'approved' })
    }
  }

  /**
   * Carry out an accept. Optimistic like dismiss, and reverted the same way —
   * but the toast names what was created, because a row that simply disappears
   * gives no evidence that a record now exists somewhere.
   */
  async function accept(item: Dated) {
    if (!item.accept) return
    const key = `${item.kind}:${item.id}`
    const copy = ACCEPT_COPY[item.accept]
    setPending(key)
    try {
      await performAccept(item)
      setDismissed((prev) => new Set(prev).add(key))
      toast.success(copy.done, { description: item.acceptName ?? item.title })
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
    if (failed === 0) {
      toast.success(`${done} accepted`, { description: 'Records created and filed.' })
    } else {
      toast.warning(`${done} accepted, ${failed} could not be`, {
        description: `${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`,
      })
    }
  }

  const urgent = live.filter((i) => i.daysLeft !== null && i.daysLeft <= 7).length

  if (live.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing waiting on you"
          description="Every inbound bid, staged thread and flagged extraction has been dealt with."
        />
      </Panel>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'lead', 'intake', 'review', 'document', 'economics'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`inline-flex items-center text-xs px-3 sm:px-2.5 min-h-11 sm:min-h-0 sm:py-1 rounded-full ring-1 ring-inset transition-colors ${
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
      {(selectable.length > 0 || bulk) && (
        <Panel className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
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
                    className="inline-flex items-center h-11 sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
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
                  className="inline-flex items-center h-11 sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
                >
                  {allShownSelected ? 'Clear shown' : 'Select all shown'}
                </button>
                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={() => setAskingBatch(true)}
                  className="inline-flex items-center gap-1.5 h-11 sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  <CheckCheck size={13} />
                  Accept {selectedItems.length > 0 ? selectedItems.length : ''}
                </button>
              </div>
            </>
          )}
        </Panel>
      )}

      <Panel className="divide-y divide-border">
        {visible.map((item) => {
          const meta = KIND_META[item.kind]
          const Icon = meta.icon
          const overdue = item.daysLeft !== null && item.daysLeft < 0
          const soon = item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 7
          return (
            <div
              key={`${item.kind}:${item.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-accent transition-colors group"
            >
              {/* Only acceptable rows get a tick box. A checkbox that selects
                  something the batch would then refuse is a promise the list
                  cannot keep, so a blocked row keeps its icon and its reason. */}
              {item.accept ? (
                <label className="relative mt-0.5 shrink-0 inline-flex items-center justify-center cursor-pointer">
                  {/* 44px hit area via an overlay, never padding — padding here
                      shifts the row under the next tap. */}
                  <span className="absolute -inset-3" aria-hidden />
                  <input
                    type="checkbox"
                    checked={selected.has(`${item.kind}:${item.id}`)}
                    onChange={() => toggle(`${item.kind}:${item.id}`)}
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
                    onClick={() => setAsking(item)}
                    disabled={pending === `${item.kind}:${item.id}`}
                    title={acceptVerb(item)}
                    className="inline-flex items-center gap-1 h-11 sm:h-7 px-3 sm:px-2 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
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
                  className="inline-flex items-center justify-center size-11 sm:size-7 -my-1.5 sm:my-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-background sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-40"
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

      {asking && asking.accept && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={acceptVerb(asking)}
          description={ACCEPT_COPY[asking.accept].ask(asking.acceptName ?? asking.title)}
          confirmLabel={acceptVerb(asking)}
          onConfirm={() => accept(asking)}
        />
      )}
    </div>
  )
}
