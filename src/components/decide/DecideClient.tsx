'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Radar, Inbox, ClipboardCheck, ArrowRight, X, Loader2, Check, CheckCheck } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import EmptyState from '@/components/shared/EmptyState'
import { decideWeight, daysUntil } from '@/lib/decide/rank'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export type DecideKind = 'lead' | 'intake' | 'review'

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
   * What accepting this row does, or null when it cannot be accepted from the
   * list. Computed server-side — the client is never handed enough of the
   * record to decide for itself.
   */
  accept: AcceptAction | null
  /** The record's name, so the confirmation can say what it will create. */
  acceptName?: string | null
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
export type AcceptAction = 'project' | 'opportunity' | 'merge' | 'steel' | 'forward' | 'approve'

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
  review: {
    label: 'Needs a check',
    icon: ClipboardCheck,
    tone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  },
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
const DISMISS: Record<DecideKind, { url: (id: string) => string; body: unknown; verb: string }> = {
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
  forward: {
    verb: 'Send to Dino',
    ask: (n) => `Forward “${n}” to Dino by email, with its attachments? Dino has no access here, so this leaves the platform.`,
    done: 'Sent to Dino',
  },
  approve: {
    verb: 'Approve',
    ask: (n) => `Approve this match${n ? ` onto “${n}”` : ''}? The correspondence is posted to the record and indexed.`,
    done: 'Match approved',
  },
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
   * ⚠ Measured on 2026-09-24, not guessed: of 80 staged sessions, 74 were
   * `create` and 6 `merge`, none said dismiss, and the average confidence was
   * 0.93 with 74 of 80 at or above this threshold. The oldest had been waiting
   * since 12 July. This button is what that backlog was waiting for.
   */
  const confident = useMemo(
    () => selectable.filter((i) => (i.confidence ?? 0) >= 0.85),
    [selectable]
  )

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
      if (item.accept === 'forward') {
        await post(`/api/leads/${item.id}/forward`, {})
      } else {
        await post(`/api/leads/${item.id}/promote`, { target: item.accept })
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
        {(['all', 'lead', 'intake', 'review'] as const).map((k) => (
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
                  : `${selectable.length} can be accepted from here`}
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
                    Select the {confident.length} Ber AI is sure about
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      selected.size >= selectable.length
                        ? new Set()
                        : new Set(selectable.map((i) => `${i.kind}:${i.id}`))
                    )
                  }
                  className="inline-flex items-center h-11 sm:h-7 px-3 sm:px-2.5 rounded-md text-xs font-medium bg-card ring-1 ring-inset ring-border hover:bg-accent transition-colors"
                >
                  {selected.size >= selectable.length ? 'Clear' : 'Select all shown'}
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
                      {item.verdict}
                      {item.score !== null && ` ${item.score}`}
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
                {item.note && (
                  <p className="text-xs text-muted-foreground/90 mt-1 line-clamp-2">{item.note}</p>
                )}
              </Link>
              <div className="flex items-center gap-1 mt-0.5 shrink-0">
                {item.accept ? (
                  <button
                    type="button"
                    onClick={() => setAsking(item)}
                    disabled={pending === `${item.kind}:${item.id}`}
                    title={ACCEPT_COPY[item.accept].verb}
                    className="inline-flex items-center gap-1 h-11 sm:h-7 px-3 sm:px-2 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                  >
                    {pending === `${item.kind}:${item.id}` ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    <span className="hidden sm:inline">{ACCEPT_COPY[item.accept].verb}</span>
                  </button>
                ) : (
                  item.blocker && (
                    // Never an Accept that would 400. The row says what it
                    // needs and sends you to the one screen that can supply it.
                    <span
                      className="hidden sm:block max-w-[14rem] text-[11px] text-amber-700 dark:text-amber-400 text-right leading-tight"
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
          title={ACCEPT_COPY[asking.accept].verb}
          description={ACCEPT_COPY[asking.accept].ask(asking.acceptName ?? asking.title)}
          confirmLabel={ACCEPT_COPY[asking.accept].verb}
          onConfirm={() => accept(asking)}
        />
      )}
    </div>
  )
}
