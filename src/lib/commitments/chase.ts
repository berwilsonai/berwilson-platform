/**
 * Draft the follow-up for something somebody owes us.
 *
 * ⚠ THE SCOPE TIERING DECIDES THE SHAPE OF THIS, AND IT WAS MEASURED BEFORE A
 * LINE WAS WRITTEN. Of 231 open commitments owed TO us, 223 sit on threads in
 * moose@/tuaone@ and 8 on info@. The deal mailboxes hold READ-ONLY Gmail scope
 * by design (§12, 09-22) — only info@ carries gmail.modify — so an in-thread
 * draft, which is what CLAUDE.md's "draft the chase in info@" imagined, can
 * reach 3.5% of the work. The other 96.5% cannot hold a draft at all.
 *
 * So the text is composed for EVERY eligible row and stored on it, and the
 * ledger page offers it for copying; where the mailbox permits a draft, one is
 * also created in the thread. That works today for all of them, needs no new
 * consent from anybody, and upgrades by itself the day those tokens are
 * re-minted with a write scope — at which point `chase_drafted_at` starts being
 * set for the rest with no change here.
 *
 * ⚠ AND IT NEVER SENDS. A draft does nothing on its own; a stored string does
 * less. That is the same structural safety model `leads/draft-reply.ts` uses,
 * and it is what keeps the "mail never becomes an action without human review"
 * rule satisfied by construction rather than by policy.
 */

import { callGemini } from '@/lib/ai/gemini'
import { sweepDb } from '@/lib/email-sweep/db'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import { GmailScopeError, createDraft } from '@/lib/integrations/gmail-write'
import { readOpenCommitments } from './read'
import type { CommitmentRow } from './db'

export const CHASE_PROMPT_VERSION = 'commitment-chase-1.0'

/**
 * How long something must have been outstanding before it is worth chasing.
 *
 * ⚠ TWO BARS, NOT ONE, because a dated and an undated obligation are different
 * objects. A missed agreed date is chaseable the day after it passes — that is
 * what agreeing a date meant. An undated one has no promise to point at, so the
 * chase has to stand on silence alone, and three weeks is the point where "just
 * checking in" is a reasonable thing for an executive to say rather than
 * nagging. §12: a threshold is measured against the corpus, never chosen — and
 * these two were separated after seeing that 369 of 476 rows carry no date, so
 * one bar would either chase everything or nothing.
 */
const OVERDUE_GRACE_DAYS = 1
const UNDATED_SILENCE_DAYS = 21

/** Never chase more than this in one pass. The model is shared and sequential. */
const MAX_PER_RUN = 12

export interface ChaseProgress {
  considered: number
  composed: number
  /** Composed and stored, but the mailbox cannot hold a draft — the usual case. */
  storedOnly: number
  drafted: number
  skipped: number
  failed: number
  errors: string[]
  /** Which mailboxes refused a draft, so the scope story stays visible. */
  noScopeMailboxes: string[]
}

const CHASE_SYSTEM_PROMPT = `You are Pepper, executive assistant to the two executives running Ber Wilson — a vertically integrated construction, development and prefab steel manufacturer.

Write ONE short follow-up email chasing something the other side owes us. You are writing it FOR the executive to send from their own mailbox, so write in their voice: direct, courteous, unbothered, the tone of somebody who expects the thing to arrive and is simply asking when.

Rules:
- Three sentences at most, plus a greeting and a sign-off line. This is a nudge, not a letter.
- Name the specific thing. "Following up on the signed NDA" — never "following up on our discussion".
- If a date was agreed, reference it once, plainly: "we had the 14th in mind". If no date was agreed, DO NOT INVENT ONE and do not imply there was one — ask when they expect it instead.
- Say how long it has been ONLY if that is more than three weeks, and say it without reproach.
- Never threaten, never escalate, never mention consequences, never cc anybody.
- Never invent a person, a price, a scope detail or a commitment of ours in return.
- Do not sign a name — the executive's own signature follows. End with a line like "Thanks" or "Appreciate it".
- Output the email body as plain text. No subject line, no headers, no markdown, no preamble.`

function daysUntil(date: string): number | null {
  const t = new Date(`${date}T00:00:00`).getTime()
  if (!isFinite(t)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((t - today.getTime()) / 86_400_000)
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return 0
  return Math.floor((Date.now() - then) / 86_400_000)
}

/** Is this one worth chasing yet? */
export function chaseable(c: CommitmentRow): boolean {
  if (c.side !== 'them') return false
  // The latch: one chase per commitment, ever. A chase a human deleted is not
  // re-drafted, because deleting it was the decision.
  if (c.chase_drafted_at || c.chase_text) return false
  if (c.due_date) {
    const d = daysUntil(c.due_date)
    return d !== null && d < -OVERDUE_GRACE_DAYS
  }
  return daysSince(c.created_at) >= UNDATED_SILENCE_DAYS
}

export async function runChasePass(opts: { dryRun?: boolean; limit?: number } = {}): Promise<
  ChaseProgress
> {
  const limit = Math.min(opts.limit ?? MAX_PER_RUN, MAX_PER_RUN)
  const progress: ChaseProgress = {
    considered: 0,
    composed: 0,
    storedOnly: 0,
    drafted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    noScopeMailboxes: [],
  }

  // Through the choke point, so a protected project's obligations never reach
  // an outbound draft. Snoozed rows are excluded: somebody said "not now".
  const { rows, error } = await readOpenCommitments({
    side: 'them',
    excludeSnoozed: true,
    limit: 1000,
  })
  if (error) {
    progress.errors.push(`Could not read the ledger: ${error}`)
    return progress
  }

  const candidates = rows.filter(chaseable)
  progress.considered = candidates.length
  progress.skipped = rows.length - candidates.length

  // Oldest first — the ones that have been waiting longest are the ones the
  // reader has least excuse for, and the cap means the rest arrive tomorrow.
  const queue = candidates
    .sort((a, b) => daysSince(a.created_at) - daysSince(b.created_at))
    .reverse()
    .slice(0, limit)

  const db = sweepDb()

  // SEQUENTIAL. One call to a model that serves one request at a time.
  for (const c of queue) {
    const age = daysSince(c.created_at)
    const overdue = c.due_date ? daysUntil(c.due_date) : null

    const context = [
      `WHAT THEY OWE US: ${c.what}`,
      c.owner_name ? `EXTRACTION NAMED: ${c.owner_name}` : 'NO OWNER NAMED',
      c.due_date
        ? `AGREED DATE: ${c.due_date}${overdue !== null && overdue < 0 ? ` (${Math.abs(overdue)} days past)` : ''}`
        : 'NO DATE WAS EVER AGREED — do not imply one',
      `OUTSTANDING: ${age} days`,
    ].join('\n')

    let text: string
    try {
      const { data } = await callGemini<string>({
        task: 'commitment-chase',
        systemPrompt: CHASE_SYSTEM_PROMPT,
        userMessage: context,
        userId: SYSTEM_USER_ID,
        promptVersion: CHASE_PROMPT_VERSION,
        jsonMode: false,
      })
      text = typeof data === 'string' ? data.trim() : String(data ?? '').trim()
    } catch (err) {
      progress.failed++
      progress.errors.push(
        `${c.id}: ${err instanceof Error ? err.message : String(err)}`
      )
      continue
    }

    if (!text) {
      progress.failed++
      progress.errors.push(`${c.id}: the model returned nothing`)
      continue
    }
    progress.composed++

    if (opts.dryRun) continue

    // Try the real draft. Where the mailbox cannot hold one — which is the
    // normal case, 223 of 231 rows — the text still lands on the commitment.
    let draftId: string | null = null
    let draftMailbox: string | null = null
    const thread = await loadThread(c.thread_id)

    if (thread?.gmail_thread_id && thread.mailbox) {
      try {
        draftId = await createDraft({
          mailbox: thread.mailbox,
          threadId: thread.gmail_thread_id,
          to: thread.counterparty ?? thread.mailbox,
          subject: thread.subject ?? 'Following up',
          html: text
            .split('\n')
            .map((line) => (line.trim() ? `<p>${line}</p>` : ''))
            .join(''),
        })
        draftMailbox = thread.mailbox
        progress.drafted++
      } catch (err) {
        if (err instanceof GmailScopeError) {
          // EXPECTED, not a failure. The deal mailboxes are read-only by
          // design and this is the scope tiering working — counted so the
          // story stays visible rather than logged as an error nobody reads.
          progress.storedOnly++
          if (!progress.noScopeMailboxes.includes(thread.mailbox)) {
            progress.noScopeMailboxes.push(thread.mailbox)
          }
        } else {
          progress.storedOnly++
          progress.errors.push(
            `${c.id}: draft refused — ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    } else {
      progress.storedOnly++
    }

    const { error: writeError } = await db
      .from('commitments')
      .update({
        chase_text: text,
        // Set ONLY when a real draft exists. The page reads this to tell the
        // reader whether the chase is already sitting in Gmail or whether they
        // are copying it out — two different actions, and claiming the first
        // when it is the second sends somebody looking for a draft that is not
        // there.
        chase_drafted_at: draftId ? new Date().toISOString() : null,
        chase_draft_id: draftId,
        chase_mailbox: draftMailbox,
      })
      .eq('id', c.id)

    if (writeError) {
      progress.failed++
      progress.errors.push(`${c.id}: could not store the chase — ${writeError.message}`)
    }
  }

  return progress
}

/** The thread a commitment was read out of, with what a reply needs. */
async function loadThread(threadId: string): Promise<{
  gmail_thread_id: string | null
  mailbox: string | null
  subject: string | null
  counterparty: string | null
} | null> {
  const { data, error } = await sweepDb()
    .from('email_threads')
    .select('gmail_thread_id, mailbox, subject, participants')
    .eq('id', threadId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as {
    gmail_thread_id: string | null
    mailbox: string | null
    subject: string | null
    participants: string[] | null
  }

  // The counterparty is the first participant who is not the mailbox itself.
  // §12: the sender is never the key to which deal mail belongs to — but for
  // "who do I reply to", the other party on the thread is exactly right.
  const mailbox = row.mailbox?.toLowerCase()
  const counterparty =
    (row.participants ?? []).find((p) => p && p.toLowerCase() !== mailbox) ?? null

  return {
    gmail_thread_id: row.gmail_thread_id,
    mailbox: row.mailbox,
    subject: row.subject,
    counterparty,
  }
}
