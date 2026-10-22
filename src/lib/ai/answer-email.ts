/**
 * EMAIL THE ANSWER TO A QUESTION THAT RAN LONG ENOUGH FOR YOU TO WALK AWAY.
 *
 * Measured on this box 2026-10-21: the median Ber AI answer takes 73 seconds,
 * the p90 takes 455, and the slowest on record took 16.8 minutes — 22 of 68
 * answers are over two minutes. The run has always survived the asker leaving
 * (nothing in the route reads `request.signal`), so the answer was already
 * landing in the database while nobody was there to see it. This is the half
 * that says so.
 *
 * ⚠ ONLY OVER THE THRESHOLD. A fast answer is one you are still looking at,
 * and mailing it would be noise — the toast covers that case.
 *
 * ⚠ CLAIM FIRST, THEN SEND. `notification_log` carries
 * `unique (kind, dedupe_key)`, which makes the insert itself the lock: a
 * `23505` means somebody already sent this and we stop. Doing it the other way
 * round risks two emails for one answer, which is the established pattern here
 * (meeting-prep and record-alert both work this way) for the same reason.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notify'
import { guardOutboundText } from '@/lib/security/egress'
import { isConfidentialProject } from '@/lib/security/confidential'

const KIND = 'agent_answer'
const UNIQUE_VIOLATION = '23505'

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * How slow an answer has to be before it is worth an email.
 *
 * Default 90s, chosen against the measured median of 73s rather than picked —
 * it catches the third of answers that actually make somebody wait and stays
 * silent on the ones they watched arrive.
 */
export const notifyAfterMs = () => envInt('AGENT_NOTIFY_AFTER_MS', 90_000)

export interface AnswerEmailResult {
  sent: boolean
  /** Always populated, in words, for the log. */
  reason: string
  /** True when the answer was withheld and only a link went out. */
  linkOnly?: boolean
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The question, short enough for a subject line. Exported for its test. */
export function subjectFor(question: string): string {
  const oneLine = question.replace(/\s+/g, ' ').trim()
  const trimmed = oneLine.length > 70 ? `${oneLine.slice(0, 70).trimEnd()}…` : oneLine
  return `Ber AI: ${trimmed}`
}

export async function emailAnswer(args: {
  /** The assistant message id — the dedupe key, so one answer sends once. */
  messageId: string
  conversationId: string
  to: string
  question: string
  answer: string
  latencyMs: number
  /** Absolute base URL. ⚠ From `publicOrigin()`, never `nextUrl.origin` (§12). */
  origin: string
  /** Set when the conversation is scoped to a deal. */
  projectId?: string
}): Promise<AnswerEmailResult> {
  if (args.latencyMs < notifyAfterMs()) {
    return { sent: false, reason: `answered in ${Math.round(args.latencyMs / 1000)}s — fast enough that nobody walked away` }
  }
  if (!args.to) return { sent: false, reason: 'no address for the asker' }

  const link = `${args.origin}/intel?conversation=${args.conversationId}`

  /*
    ⚠ CONTAINMENT, AND IT IS DECIDED BEFORE THE BODY IS BUILT.

    §8: a `confidential` project leaves every OUTBOUND channel, and email is
    the most outbound of them — it goes through Gmail, off this box, and
    cannot be recalled. Two independent tests, additively, because they catch
    different things: the conversation's own scope catches a question asked ON
    a protected deal, and the name guard catches a portfolio-wide question
    whose ANSWER happens to discuss one.

    Failing closed costs one click. Failing open cannot be undone, which is
    why there is no opt-out parameter here for a caller to forget.
  */
  let linkOnly = false
  let withheldBecause = ''

  if (args.projectId && (await isConfidentialProject(args.projectId))) {
    linkOnly = true
    withheldBecause = 'the conversation is scoped to a protected project'
  } else {
    const verdict = await guardOutboundText(`${args.question}\n\n${args.answer}`)
    if (!verdict.ok) {
      linkOnly = true
      withheldBecause = verdict.reason
    }
  }

  // Claim the send before making it.
  const admin = createAdminClient()
  const { error: claimErr } = await admin
    .from('notification_log')
    .insert({
      kind: KIND,
      channel: 'email',
      dedupe_key: args.messageId,
      status: 'sent',
    })

  if (claimErr) {
    if (claimErr.code === UNIQUE_VIOLATION) {
      return { sent: false, reason: 'already emailed — another path got there first' }
    }
    // Loud: this exact write failed silently for five weeks once, and the
    // idempotency it provides is the only thing stopping a double send.
    console.error('[answer-email] could not claim notification_log:', claimErr.message)
    return { sent: false, reason: `could not claim the send: ${claimErr.message}` }
  }

  const seconds = Math.round(args.latencyMs / 1000)
  const took = seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`

  const html = linkOnly
    ? `<p>Your Ber AI answer is ready — it took ${took}.</p>` +
      `<p><a href="${link}">Open it in the platform</a></p>` +
      `<p style="color:#666;font-size:13px">The answer itself is not in this email because ` +
      `${escapeHtml(withheldBecause)}. Protected work never leaves the box.</p>`
    : `<p style="color:#666;font-size:13px">You asked, ${escapeHtml(took)} ago:</p>` +
      `<blockquote style="margin:0 0 16px;padding-left:12px;border-left:3px solid #ddd;color:#444">` +
      `${escapeHtml(args.question)}</blockquote>` +
      `<div>${escapeHtml(args.answer).replace(/\n/g, '<br>')}</div>` +
      `<p style="margin-top:20px"><a href="${link}">Open the conversation</a> to ask a follow-up — ` +
      `it will remember this one.</p>`

  const result = await notify({
    kind: KIND,
    channel: 'email',
    to: args.to,
    subject: subjectFor(args.question),
    html,
  })

  if (!result.ok) {
    await admin
      .from('notification_log')
      .update({ status: 'failed', error: result.error ?? 'unknown' })
      .eq('kind', KIND)
      .eq('dedupe_key', args.messageId)
    return { sent: false, reason: result.error ?? 'send failed', linkOnly }
  }

  return {
    sent: true,
    reason: linkOnly ? `link only — ${withheldBecause}` : `emailed after ${took}`,
    linkOnly,
  }
}
