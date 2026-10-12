/**
 * Obligations the two executives give each other become tasks on the board.
 *
 * ⚠ THIS IS A DELIBERATE, NARROW EXCEPTION TO §11, MADE BY RICHARD ON
 * 2026-10-12. The standing rule is that mail never becomes a record without a
 * human confirm, and it stands everywhere else: no project, opportunity, party
 * or lead is created here, and nothing a counterparty writes reaches this
 * function at all. What it covers is the case the rule was never aimed at — a
 * conversation in which EVERY participant is one of our own people, telling
 * each other what we owe. There is no third party to misfile and no
 * counterparty to misattribute.
 *
 * WHY IT WAS NEEDED. Eric texted a rundown of every outstanding item on
 * 2026-10-11 at 20:29 — Dino Plumbing, Brass Kisses, Fairbanks Mining, the Tim
 * Seibert and Mortenson teaming agreements, the CoreWeave GC, the Kiewit power
 * agreement — and Richard replied "Perfect I'll get these tasks in BI". The
 * platform HAD read all seven, correctly, within the hour. They were
 * commitments 356 to 367 of a 367-row ledger, attached to no record and on no
 * board, so the surface Richard works from showed none of them while 11 of its
 * 22 open rows were unsolicited RFP deadlines. The extraction was never the
 * problem; the ledger had no door onto the board.
 *
 * THE FOUR THINGS THAT BOUND IT, each measured rather than chosen:
 *
 *  1. INTERNAL ONLY — every participant on the thread is one of ours. See
 *     {@link isInternalThread}, which keys on ADDRESSES and never on display
 *     names (§12: a display string is not an API contract, including ours — the
 *     Pepper self-loop guard was defeated by exactly that).
 *
 *  2. `side = 'us'` ONLY. For 'us' the owner is an internal person who took the
 *     thing on, and `attribute()` resolves that correctly today. For 'them' on
 *     an internal thread the owner is the OTHER executive, whom `attribute()`
 *     deliberately resolves by mailbox — which on Richard's own Messages would
 *     put Eric's obligations on Richard's board as things he owes himself. That
 *     is §12's "never print a reader's own name back at them" in a new costume.
 *     Those rows stay in the ledger, where the morning note already reports
 *     them as awaited.
 *
 *  3. A LIVE CONVERSATION — the thread has a message inside
 *     {@link LIVE_CORRESPONDENCE_DAYS}. This is the SAME window the board's
 *     'live' tier uses, on purpose: §12 says one quantity gets one definition
 *     or the reader trusts none of them. An obligation off a conversation that
 *     went quiet two months ago is ledger material, not board material, and
 *     promoting it would rebuild the clutter this change exists to remove.
 *     Measured 2026-10-12: 64 open internal 'us' commitments in all, 38 inside
 *     14 days, 30 inside 7.
 *
 *  4. ONE TASK, ONCE, FOREVER — `tasks.commitment_id` is unique and survives
 *     the task being completed OR deleted (ON DELETE SET NULL points the other
 *     way, from the commitment). Deleting a promoted task IS the decision that
 *     it is not work; resurrecting it on the next sweep is the behaviour that
 *     made the lead-deadline tasks unbearable.
 *
 * THE LOOP CLOSES BOTH WAYS. A commitment the sweep re-reads as settled closes
 * its task here; completing the task settles the commitment (see
 * `settleCommitmentForTask`). Two ledgers that disagree about the same promise
 * are worse than one, and as of 2026-10-11 `count(settled_by)` across 407 open
 * commitments was still zero — the closing half had never once been used.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sweepDb } from '@/lib/email-sweep/db'
import { loadPepperMembers, attribute, type PepperMember } from '@/lib/pepper/attribution'
import { normalizePhone } from '@/lib/imessage/classify'
import { MAILBOXES } from '@/lib/integrations/google-workspace'
import { LIVE_CORRESPONDENCE_DAYS } from '@/lib/tasks/priority'
import { settleCommitment } from './settle'
import type { CommitmentRow } from './db'

export interface InternalTaskProgress {
  /** Open internal 'us' commitments inside the window. */
  considered: number
  created: number
  /** Tasks closed because their commitment is no longer open. */
  closed: number
  /** Tasks reopened because their commitment went back to open. */
  reopened: number
  /** Promoted but with nobody to own them — see the note on attribution. */
  unassigned: number
  /** Already promoted on an earlier run, including ones since deleted. */
  alreadyPromoted: number
  skipped: boolean
  reason?: string
  errors: string[]
}

function emptyProgress(): InternalTaskProgress {
  return {
    considered: 0,
    created: 0,
    closed: 0,
    reopened: 0,
    unassigned: 0,
    alreadyPromoted: 0,
    skipped: false,
    errors: [],
  }
}

/**
 * Every address that is one of our own people.
 *
 * Three sources, because a person reaches us under more than one name:
 *   - the deal mailboxes (`MAILBOXES`), which is what mail arrives under;
 *   - every address on a team member's own contact record, which is how
 *     `PepperMember.addresses` already solved the same problem for the meeting
 *     nudge (Richard attends some meetings from a personal Gmail);
 *   - the iMessage pseudo-addresses, `<10 digits>@imessage.local`, which is what
 *     `to-thread.ts` renders a colleague's handle as when their `parties.phone`
 *     is a different number from the one they text from. Eric's record holds
 *     …5507 and he texts from …6519, so without `IMESSAGE_INTERNAL_HANDLES` his
 *     thread would not read as internal at all.
 *
 * ⚠ THE ASSISTANT SEAT (info@) IS NOT INTERNAL FOR THIS PURPOSE. It is the
 * company's front door: a thread whose only participants are info@ and one
 * executive is usually forwarded counterparty mail, and `attribute()` already
 * refuses to put its obligations on a person. Leaving it out keeps this pass
 * away from the whole lead pipeline, which arrives there.
 */
export function internalAddresses(members: PepperMember[]): Set<string> {
  const addresses = new Set<string>()

  for (const m of MAILBOXES) addresses.add(m.toLowerCase())

  for (const member of members) {
    if (member.isAssistantSeat) continue
    for (const a of member.addresses) addresses.add(a.toLowerCase())
  }

  for (const raw of (process.env.IMESSAGE_INTERNAL_HANDLES ?? '').split(',')) {
    const n = normalizePhone(raw.trim())
    if (n) addresses.add(`${n}@imessage.local`)
  }

  return addresses
}

/**
 * True when every participant on the thread is one of ours.
 *
 * ⚠ A THREAD WITH NO RECORDED PARTICIPANTS IS NOT INTERNAL. An empty array
 * would make the "no outsider present" test vacuously true, which is the shape
 * that turns a filter into no filter at all.
 */
export function isInternalThread(
  participants: string[] | null | undefined,
  internal: Set<string>
): boolean {
  if (!Array.isArray(participants) || participants.length === 0) return false
  return participants.every((p) => internal.has(p.trim().toLowerCase()))
}

/** What the task says, beyond its title. */
function describe(row: CommitmentRow & { thread: { subject: string | null } | null }): string {
  const lines = [
    'Read out of correspondence between us — not from a counterparty.',
    row.thread?.subject ? `Conversation: ${row.thread.subject}` : null,
    row.owner_name ? `Extraction named: ${row.owner_name}` : null,
    '',
    process.env.APP_URL
      ? `Settle it either here or on the ledger: ${process.env.APP_URL}/commitments?commitment=${row.id}`
      : 'Settle it either here or on /commitments.',
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

/**
 * Promote live internal obligations onto the board, and close the ones that
 * have since been settled.
 *
 * Never throws — the ledger is intact whatever the board does.
 */
export async function promoteInternalCommitments(
  opts: { dryRun?: boolean } = {}
): Promise<InternalTaskProgress> {
  const progress = emptyProgress()
  const dryRun = opts.dryRun ?? false

  try {
    const supabase = createAdminClient()
    const members = await loadPepperMembers(supabase)
    const internal = internalAddresses(members)

    const since = new Date(Date.now() - LIVE_CORRESPONDENCE_DAYS * 86_400_000).toISOString()

    // ── 1. Close tasks whose commitment is no longer open ────────────────────
    //
    // Read FIRST, so a run that reports "closed 3" has actually closed three
    // (§12: a pass that reports what it did must read before it writes).
    type PromotedTask = {
      id: string
      status: string
      commitment_id: string
      commitment: { status: string } | { status: string }[] | null
    }

    // ⚠ PAGED. This is the latch, and it only ever grows: PostgREST truncates
    // at 1000 rows silently (§12), and a short read here would re-promote
    // whatever fell off the end — a duplicate task for an obligation already on
    // the board, which is exactly what the latch exists to prevent.
    const promoted: PromotedTask[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error: promotedErr } = await supabase
        .from('tasks')
        .select('id, status, commitment_id, commitment:commitments(status)')
        .not('commitment_id', 'is', null)
        .order('id')
        .range(from, from + PAGE - 1)
      if (promotedErr) return { ...progress, skipped: true, reason: promotedErr.message }
      const page = (data ?? []) as unknown as PromotedTask[]
      promoted.push(...page)
      if (page.length < PAGE) break
    }
    progress.alreadyPromoted = promoted.length
    const promotedIds = new Set(promoted.map((t) => t.commitment_id))

    for (const task of promoted) {
      const c = Array.isArray(task.commitment) ? task.commitment[0] : task.commitment
      // A commitment row that has gone (deleted on the ledger) leaves the task
      // alone: somebody's open work must not vanish because of a tidy-up
      // elsewhere.
      if (!c) continue

      // The obligation was settled somewhere else — close the task to match.
      if (task.status === 'open' && c.status !== 'open') {
        if (!dryRun) {
          const { error } = await supabase
            .from('tasks')
            .update({ status: 'done', completed_at: new Date().toISOString() })
            .eq('id', task.id)
          if (error) {
            if (progress.errors.length < 5) progress.errors.push(error.message)
            continue
          }
        }
        progress.closed++
        continue
      }

      /**
       * ⚠ AND THE OTHER DIRECTION, WHICH THE LATCH MAKES NECESSARY RATHER THAN
       * MERELY TIDY. `tasks.commitment_id` is unique and permanent, so a
       * commitment whose task is closed can never be promoted again — which
       * means that without this, an obligation reopened on the ledger would be
       * open, counted, named in the morning note, and reachable from no board
       * forever. The ledger's `open` verdict IS the undo (see settle.ts), and
       * only a human can issue it, so following it is never a machine
       * second-guessing somebody's completed work.
       */
      if (task.status !== 'open' && c.status === 'open') {
        if (!dryRun) {
          const { error } = await supabase
            .from('tasks')
            .update({ status: 'open', completed_at: null })
            .eq('id', task.id)
          if (error) {
            if (progress.errors.length < 5) progress.errors.push(error.message)
            continue
          }
        }
        progress.reopened++
      }
    }

    // ── 2. Promote what is live and not yet promoted ──────────────────────────
    const { data: rows, error } = await sweepDb()
      .from('commitments')
      .select('*, thread:email_threads(subject, participants, last_at, mailbox)')
      .eq('status', 'open')
      .eq('side', 'us')
      .limit(500)
    if (error) return { ...progress, skipped: true, reason: error.message }

    type Joined = CommitmentRow & {
      thread: {
        subject: string | null
        participants: string[] | null
        last_at: string | null
        mailbox: string | null
      } | null
    }

    for (const raw of (rows ?? []) as unknown as Joined[]) {
      const thread = Array.isArray(raw.thread) ? raw.thread[0] : raw.thread
      if (!thread) continue
      if (!isInternalThread(thread.participants, internal)) continue
      if (!thread.last_at || thread.last_at < since) continue

      progress.considered++
      if (promotedIds.has(raw.id)) continue

      // Side is 'us' by the query above, so the named owner is an internal
      // person and resolving it is exactly right. The mailbox is the fallback,
      // which for a text session is the owner of the Messages database.
      const who = attribute(raw.owner_name, thread.mailbox, members, 'us')
      const assigneeId = who.kind === 'member' ? who.memberId : null
      if (!assigneeId) progress.unassigned++

      if (dryRun) {
        progress.created++
        continue
      }

      const { error: insErr } = await supabase.from('tasks').insert({
        title: raw.what.slice(0, 200),
        due_date: raw.due_date,
        assignee_id: assigneeId,
        status: 'open',
        commitment_id: raw.id,
        project_id: raw.project_id,
        opportunity_id: raw.opportunity_id,
        what: describe({ ...raw, thread: { subject: thread.subject } }),
        // No fit score, no confidence number, no "as of". §12: these columns are
        // STORED and are what Pepper emails, so anything derived from the clock
        // or from a noisy metric is wrong the day after it is written.
        why: 'Outstanding between Richard and Eric',
      })

      if (insErr) {
        if (progress.errors.length < 5) progress.errors.push(insErr.message)
        continue
      }
      progress.created++
    }
  } catch (err) {
    progress.errors.push(err instanceof Error ? err.message : String(err))
  }

  return progress
}

/**
 * Completing a promoted task settles the obligation it came from.
 *
 * The point of promoting at all is that there is ONE decision, not two ledgers
 * that drift. Fire-and-forget and never throws: the task status is already
 * recorded, and the ledger write must not fail the request that made it.
 *
 * `reopen` carries the undo through as well — a task ticked by accident and
 * un-ticked would otherwise leave the commitment closed with Richard's name on
 * it.
 */
export function settleCommitmentForTask(
  commitmentId: string | null | undefined,
  status: string,
  settledBy: string
): void {
  if (!commitmentId) return
  void (async () => {
    const verdict = status === 'done' ? 'done' : status === 'open' ? 'open' : null
    if (!verdict) return
    await settleCommitment(commitmentId, verdict, settledBy)
  })().catch((err) => {
    console.warn(
      '[commitments/internal-tasks] could not settle alongside the task:',
      err instanceof Error ? err.message : err
    )
  })
}
