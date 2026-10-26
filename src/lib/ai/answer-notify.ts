/**
 * TELL THE ASKER THEIR ANSWER IS READY — TEXT FIRST, EMAIL BEHIND IT.
 *
 * Measured on this box 2026-10-21: the median Ber AI answer takes 73 seconds,
 * the p90 takes 455, and the slowest on record took 16.8 minutes — 22 of 68
 * answers are over two minutes. The run has always survived the asker leaving
 * (nothing in the route reads `request.signal`), so the answer was already
 * landing in the database while nobody was there to see it. This is the half
 * that says so.
 *
 * ⚠ TWO CHANNELS, ONE PASS, BECAUSE THEY CARRY DIFFERENT THINGS AND A FORK
 * WOULD DRIFT (§12 — never fork a shared pass, add a target). The text is a
 * POINTER: the question, so you know which answer it is, and a link that opens
 * that conversation in Ber Intelligence. The email carries the whole answer,
 * because a 3,000-character answer cannot be a text — measured 2026-10-23, the
 * median assistant message is 3,046 characters and the longest is 17,145, while
 * the longest text this box has ever actually delivered is 357.
 *
 * ⚠ AND THE TEXT DELIBERATELY DOES NOT SUMMARIZE. The first version of this
 * had a model write a bottom line for the lock screen. It worked — 186 to 235
 * characters on real answers, the royalty and the caveat intact — and Richard
 * replaced it the same day: *"Maybe you just text me a link to the response. I
 * click the link and it takes me to Ber Intelligence to view the output."*
 * That is the better design and not only because it is simpler. A summary of
 * an answer is a SECOND answer: it can be wrong on its own, it is new prose
 * that has to be guarded on its own, and it cost a model call that queued
 * behind whatever else held LM Studio — measured at 80s, 121s and 531s against
 * the ~2s this version takes. A pointer cannot be wrong about the thing it
 * points at.
 *
 * ⚠ ONLY OVER THE THRESHOLD. A fast answer is one you are still looking at,
 * and buzzing a phone for it is noise — the toast covers that case. The bar has
 * never once fired: the single question asked since it shipped took 87.6s, two
 * seconds under it (10-23 03:16:50 → 03:18:18).
 *
 * ⚠ CLAIM FIRST, THEN SEND, PER CHANNEL. `notification_log` carries
 * `unique (kind, dedupe_key)`, which makes the insert itself the lock: a
 * `23505` means somebody already sent this and we stop. The key is suffixed
 * with the channel because one kind now sends twice and the constraint is on
 * the PAIR — without the suffix the text would be permanently swallowed by the
 * email's own claim. Doing it the other way round risks two sends for one
 * answer, which is the established pattern here (meeting-prep and record-alert
 * both work this way) for the same reason.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notify'
import { gatewaySender } from '@/lib/notify/text'
import { guardOutboundText } from '@/lib/security/egress'
import { isConfidentialProject } from '@/lib/security/confidential'

const KIND = 'agent_answer'

/** The one sender identity for everything Pepper sends — see `notify/pair.ts`. */
function gatewaySenderFields(): { from: string; fromName: string } {
  const { from, fromName } = gatewaySender()
  return { from, fromName }
}
const UNIQUE_VIOLATION = '23505'

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * How slow an answer has to be before it is worth a message.
 *
 * Default 90s, chosen against the measured median of 73s rather than picked —
 * it catches the third of answers that actually make somebody wait and stays
 * silent on the ones they watched arrive.
 */
export const notifyAfterMs = () => envInt('AGENT_NOTIFY_AFTER_MS', 90_000)

/**
 * How much of the question rides along in the text, before the link.
 *
 * ⚠ MEASURED AGAINST WHAT THIS CHANNEL HAS DELIVERED, not against the SMS
 * spec. The longest body `pepper_outbound_texts` records as sent is 357
 * characters; 160 of question plus a ~100-character tailnet link sits well
 * inside it. §12: a threshold is measured against the real corpus, never
 * chosen. The question is there so two answers arriving together are told
 * apart — it is an identifier, not content.
 */
export const QUESTION_MAX_CHARS = envInt('AGENT_TEXT_QUESTION_CHARS', 160)

export interface AnswerNotifyResult {
  /** True when the full answer went out by email. */
  emailed: boolean
  /** True when the bottom line went out as a text. */
  texted: boolean
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

/**
 * Cut to a length on a sentence boundary where there is one, a word boundary
 * otherwise, and say so with an ellipsis.
 *
 * ⚠ A HARD SLICE MID-NUMBER IS WORSE THAN A SHORTER MESSAGE. "the PSA closes
 * 17 Oct for $13" is a figure that reads as complete and is not, and a figure
 * is the thing most likely to be acted on from a lock screen (§12 — a money
 * figure must carry its shape).
 */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const window = flat.slice(0, max - 1)
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
  if (sentence > max * 0.5) return window.slice(0, sentence + 1)
  const word = window.lastIndexOf(' ')
  return `${(word > max * 0.5 ? window.slice(0, word) : window).trimEnd()}…`
}

/**
 * The text itself: which question, and the link that opens the answer.
 *
 * ⚠ PURE, AND EXPORTED, BECAUSE THIS STRING IS THE WHOLE FEATURE. Everything
 * else in this file is plumbing around it; if it is wrong nobody finds out,
 * because a text that reads badly still reports `sent`. A pure function is one
 * a test can read character by character without a database or a phone.
 *
 * ⚠ THE WITHHELD FORM NAMES NO QUESTION. When containment fired, the QUESTION
 * is suspect too — it is the thing most likely to carry the protected
 * project's name, since that is usually what was asked about. So the withheld
 * body drops it entirely rather than clipping it and hoping.
 *
 * The carrier renders the gateway subject ("Ber AI") as the first line, so
 * this body never repeats it.
 */
export function composeAnswerText(args: {
  question: string
  link: string
  took: string
  /** The GENERIC reason, when containment fired. Null on the normal path. */
  withheld: string | null
}): string {
  if (args.withheld) {
    return [
      `Your answer is ready (${args.took}), but not in this text because ${args.withheld}.`,
      args.link,
    ].join('\n\n')
  }
  return [`Answered: ${clip(args.question, QUESTION_MAX_CHARS)}`, args.link].join('\n\n')
}

/** How long it took, in the words a person would use. Exported for its test. */
export function tookPhrase(latencyMs: number): string {
  const seconds = Math.round(latencyMs / 1000)
  return seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`
}

/**
 * Claim one channel's send. The insert IS the lock; `false` means stop.
 */
async function claim(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  channel: 'email' | 'text'
): Promise<{ ok: boolean; reason: string }> {
  const { error } = await admin.from('notification_log').insert({
    kind: KIND,
    channel,
    // ⚠ SUFFIXED. The constraint is `unique (kind, dedupe_key)`, so two
    // channels under one kind need two keys or the second never sends.
    dedupe_key: `${messageId}:${channel}`,
    status: 'sent',
  })
  if (!error) return { ok: true, reason: '' }
  if (error.code === UNIQUE_VIOLATION) {
    return { ok: false, reason: `already sent by ${channel} — another path got there first` }
  }
  // Loud: this exact write failed silently for five weeks once, and the
  // idempotency it provides is the only thing stopping a double send.
  console.error(`[answer-notify] could not claim ${channel}:`, error.message)
  return { ok: false, reason: `could not claim the ${channel} send: ${error.message}` }
}

async function markFailed(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  channel: 'email' | 'text',
  detail: string
) {
  await admin
    .from('notification_log')
    .update({ status: 'failed', error: detail })
    .eq('kind', KIND)
    .eq('dedupe_key', `${messageId}:${channel}`)
}

export async function notifyAnswer(args: {
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
  /**
   * Was the asker actually looking when the answer landed?
   *
   * ⚠ THIS REPLACES THE STOPWATCH AS THE DECIDING QUESTION, and the stopwatch
   * was answering the wrong one. The 90s bar was set against a measured median
   * of 73s on the premise that "a fast answer is one you are still looking at".
   * Richard, 2026-10-25: *"I need to be able to close it while it thinks. I
   * don't want to wait while it finds answers."* That makes the premise false
   * by instruction — the intent is to walk away from EVERY question. Measured
   * the same day: **40 of 72 answers came back under 90 seconds**, so on the
   * majority of questions the old rule notified nobody the moment he left.
   *
   *   false — nobody was there. Send it, however fast it was.
   *   true  — they watched it arrive. Send nothing; the screen already did it.
   *   null/undefined — not known. Fall back to the duration, which is the old
   *                    behaviour and the right default for a caller that
   *                    cannot see a client at all.
   */
  watched?: boolean | null
}): Promise<AnswerNotifyResult> {
  const watched = args.watched ?? null
  if (watched === true) {
    return {
      emailed: false,
      texted: false,
      reason: 'the asker watched it arrive — the screen already told them',
    }
  }
  // Only a caller that could not tell falls back to the clock.
  if (watched === null && args.latencyMs < notifyAfterMs()) {
    return {
      emailed: false,
      texted: false,
      reason: `answered in ${Math.round(args.latencyMs / 1000)}s and nothing reported whether anyone was watching`,
    }
  }
  if (!args.to) return { emailed: false, texted: false, reason: 'no address for the asker' }

  const link = `${args.origin}/intel?conversation=${args.conversationId}`

  /*
    ⚠ CONTAINMENT, AND IT IS DECIDED ONCE, BEFORE EITHER BODY IS BUILT.

    §8: a `confidential` project leaves every OUTBOUND channel, and both of
    these are outbound — the email goes through Gmail and the text goes through
    Gmail to a carrier, so neither can be recalled. Two independent tests,
    additively, because they catch different things: the conversation's own
    scope catches a question asked ON a protected deal, and the name guard
    catches a portfolio-wide question whose ANSWER happens to discuss one.

    Failing closed costs one click. Failing open cannot be undone, which is
    why there is no opt-out parameter here for a caller to forget.
  */
  let linkOnly = false
  let withheldBecause = ''
  /**
   * ⚠ WHAT THE RECIPIENT IS TOLD, WHICH IS NOT WHAT THE LOG IS TOLD.
   *
   * `guardOutboundText` names the project it caught — *it names a protected
   * project ("X")* — because that is what a server log needs. Putting that
   * string in the message would send the protected name down the very channel
   * the guard exists to keep it off, which is exactly what this code did until
   * 2026-10-23. The outbound sentence names no record.
   */
  const withheldPublic = 'it touches a protected project'

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

  const admin = createAdminClient()
  const took = tookPhrase(args.latencyMs)
  const notes: string[] = []

  // ── Email: the whole answer ───────────────────────────────────────────────
  // First because it needs no model call, so a stalled LM Studio cannot hold
  // up the channel that carries the actual content.
  let emailed = false
  const emailClaim = await claim(admin, args.messageId, 'email')
  if (!emailClaim.ok) {
    notes.push(emailClaim.reason)
  } else {
    const html = linkOnly
      ? `<p>Your Ber AI answer is ready — it took ${took}.</p>` +
        `<p><a href="${link}">Open it in the platform</a></p>` +
        `<p style="color:#666;font-size:13px">The answer itself is not in this email because ` +
        `${withheldPublic}. Protected work never leaves the box.</p>`
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
      // ⚠ AS `info@`, SIGNED AS PEPPER — the same seat as the text beside it
      // (Richard, 2026-10-26). Two reasons, and the second is structural: this
      // defaulted to `Ber Intelligence <moose@berwilson.com>`, which is
      // Richard's OWN address, so his answer looked like mail he had sent
      // himself; and the sweep's own-mail guard then rested on the display
      // NAME matching `PLATFORM_SENDER_NAME`, which §12 says is not a
      // contract. `isPlatformMail` keys on the assistant seat's ADDRESS, so
      // sending from `info@` is the arm no rename can reopen.
      ...gatewaySenderFields(),
    })
    if (result.ok) {
      emailed = true
    } else {
      await markFailed(admin, args.messageId, 'email', result.error ?? 'unknown')
      notes.push(`email failed: ${result.error ?? 'unknown'}`)
    }
  }

  // ── Text: which question, and the link that opens it ─────────────────────
  let texted = false
  const textClaim = await claim(admin, args.messageId, 'text')
  if (!textClaim.ok) {
    notes.push(textClaim.reason)
  } else {
    const body = composeAnswerText({
      question: args.question,
      link,
      took,
      withheld: linkOnly ? withheldPublic : null,
    })

    const result = await notify({
      kind: KIND,
      channel: 'text',
      to: args.to,
      subject: 'Ber AI',
      html: '',
      text: body,
      textKind: 'agent_answer',
    })
    if (result.ok) {
      texted = true
    } else {
      await markFailed(admin, args.messageId, 'text', result.error ?? 'unknown')
      notes.push(`text failed: ${result.error ?? 'unknown'}`)
    }
  }

  const sentParts = [emailed ? 'emailed' : null, texted ? 'texted' : null].filter(Boolean)
  const headline = sentParts.length
    ? `${sentParts.join(' and ')} after ${took}${linkOnly ? ` — link only, ${withheldBecause}` : ''}`
    : `nothing sent after ${took}`

  return {
    emailed,
    texted,
    linkOnly,
    reason: notes.length ? `${headline} (${notes.join('; ')})` : headline,
  }
}
