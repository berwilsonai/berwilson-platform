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
 * WOULD DRIFT (§12 — never fork a shared pass, add a target). The text is the
 * thing that reaches a pocket, and it carries the BOTTOM LINE plus a link; the
 * email carries the whole answer, because a 3,000-character answer cannot be a
 * text. Measured 2026-10-23: the median assistant message is 3,046 characters
 * and the longest is 17,145, while the longest text this box has ever actually
 * delivered is 357 (a `record_alert`). Sending the full answer over the carrier
 * gateway would be ~20 SMS segments whose ordering and truncation are the
 * carrier's decision, not ours.
 *
 * Richard chose this shape on 2026-10-23: *"When I ask Ber AI a question, I
 * want it to text the response to me."* — a TLDR plus a link, over 90 seconds,
 * with the email kept for the full text.
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
import { callGemini } from '@/lib/ai/gemini'
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
 * How slow an answer has to be before it is worth a message.
 *
 * Default 90s, chosen against the measured median of 73s rather than picked —
 * it catches the third of answers that actually make somebody wait and stays
 * silent on the ones they watched arrive.
 */
export const notifyAfterMs = () => envInt('AGENT_NOTIFY_AFTER_MS', 90_000)

/**
 * The most text a TLDR may be, before the link is added.
 *
 * ⚠ MEASURED AGAINST WHAT THIS CHANNEL HAS DELIVERED, not against the SMS spec.
 * The longest body `pepper_outbound_texts` records as sent is 357 characters
 * (`record_alert`); 240 plus a ~60-character tailnet link sits inside that with
 * room for a deal name. §12: a threshold is measured against the real corpus,
 * never chosen.
 */
export const TLDR_MAX_CHARS = envInt('AGENT_TEXT_TLDR_CHARS', 240)

export interface AnswerNotifyResult {
  /** True when the full answer went out by email. */
  emailed: boolean
  /** True when the bottom line went out as a text. */
  texted: boolean
  /** Always populated, in words, for the log. */
  reason: string
  /** True when the answer was withheld and only a link went out. */
  linkOnly?: boolean
  /** Where the texted bottom line came from. Absent when nothing was texted. */
  tldrSource?: TldrSource
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

export type TldrSource =
  /** The answer was already short enough to send as it stands. */
  | 'verbatim'
  /** A model wrote the bottom line. */
  | 'model'
  /** The model call failed or came back unusable; the answer was trimmed. */
  | 'trimmed'

/**
 * An answer with its markup taken off, so it can be read on a lock screen.
 *
 * The agent answers in markdown — headings, bold, bullets, tables, citations —
 * and a carrier renders none of it. `**17 October**` arrives as asterisks and
 * `## How SBIR Phase III Money Works` arrives with the hashes still on it.
 */
export function plainText(markdown: string): string {
  return markdown
    // Fenced code goes entirely: it is never the bottom line and it is the
    // one block whose innards must not be unwrapped.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*[-=]{3,}\s*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
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

const TLDR_PROMPT = `You write the one-line bottom line of an answer, for a text message on a phone.

Rules:
- Lead with the FINDING, never with "the answer is" or "I found that".
- At most two sentences and ${TLDR_MAX_CHARS} characters. Shorter is better.
- Plain text only: no markdown, no bullets, no headings, no links, no emoji.
- Keep the specifics — a date, a figure, a name — and drop the reasoning.
- If the answer is that something is missing or unknown, say that plainly.
- Write it as the answer itself, not as a description of the answer.

Reply with the sentence and nothing else.`

/**
 * The bottom line of an answer, for the text.
 *
 * ⚠ THE MODEL CALL IS THE PREFERRED PATH AND NEVER THE REQUIRED ONE. LM Studio
 * serves one request at a time (§12), so this call queues, and the whole point
 * of this pass is that it runs after the asker has walked away — a stall here
 * must cost a worse sentence, not the message. Every failure falls through to
 * the trimmed answer, which is always available because it is pure string work.
 */
export async function composeTldr(args: {
  question: string
  answer: string
  userId: string
}): Promise<{ text: string; source: TldrSource }> {
  const plain = plainText(args.answer)

  // ⚠ NO MODEL CALL WHEN THE ANSWER ALREADY FITS. Richard asked to be texted
  // "the response"; when the response is 38 characters that is exactly what
  // this sends, and summarizing it would be a round trip to make it worse.
  if (plain.length <= TLDR_MAX_CHARS) return { text: plain, source: 'verbatim' }

  try {
    const { data } = await callGemini<string>({
      task: 'answer-tldr',
      systemPrompt: TLDR_PROMPT,
      userMessage: `QUESTION\n${args.question}\n\nANSWER\n${args.answer}`,
      userId: args.userId,
      promptVersion: 'answer-tldr-1.0',
      jsonMode: false,
      /*
        ⚠ BUDGETED FOR THE THINKING, NOT FOR THE SENTENCE. The output here is
        240 characters — about 60 tokens — but `qwen3.6` reasons first and
        those tokens come out of the same budget. A cap sized to the answer
        spends the whole allowance thinking and emits nothing, which this code
        would read as a failed call and silently downgrade to the trimmed
        answer forever. Every other prose call in this repo budgets 1500-8000
        for the same reason; 300 was the outlier.
      */
      maxTokens: 2048,
    })
    const written = typeof data === 'string' ? plainText(data) : ''
    // A model asked for one sentence sometimes returns a preamble and a list.
    // Anything that comes back long is still better trimmed than discarded,
    // but it is no longer "what the model wrote" and the log should say so.
    if (written.length >= 10) {
      return written.length <= TLDR_MAX_CHARS
        ? { text: written, source: 'model' }
        : { text: clip(written, TLDR_MAX_CHARS), source: 'trimmed' }
    }
  } catch (err) {
    console.warn('[answer-notify] TLDR call failed:', err instanceof Error ? err.message : err)
  }

  return { text: clip(plain, TLDR_MAX_CHARS), source: 'trimmed' }
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
   * The asker, for the `ai_queries` row the TLDR call writes.
   *
   * ⚠ REQUIRED, AND IT MUST BE A REAL `auth.users` UUID. `ai_queries.user_id`
   * is a NOT NULL uuid and `logAiQuery` is fire-and-forget with no error
   * branch, so a placeholder like `'system'` fails `22P02` and the call simply
   * never appears in the log — breaking the §2 contract that EVERY AI call is
   * logged, with nothing anywhere saying so. Caught on 10-23 by a verification
   * script that passed `'verify'` and produced a model answer with no row
   * behind it. Required rather than defaulted so `tsc` names any caller that
   * cannot supply one.
   */
  userId: string
}): Promise<AnswerNotifyResult> {
  if (args.latencyMs < notifyAfterMs()) {
    return {
      emailed: false,
      texted: false,
      reason: `answered in ${Math.round(args.latencyMs / 1000)}s — fast enough that nobody walked away`,
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
    })
    if (result.ok) {
      emailed = true
    } else {
      await markFailed(admin, args.messageId, 'email', result.error ?? 'unknown')
      notes.push(`email failed: ${result.error ?? 'unknown'}`)
    }
  }

  // ── Text: the bottom line, and a link to the rest ─────────────────────────
  let texted = false
  let tldrSource: TldrSource | undefined
  const textClaim = await claim(admin, args.messageId, 'text')
  if (!textClaim.ok) {
    notes.push(textClaim.reason)
  } else {
    let body: string
    if (linkOnly) {
      body = [`Your Ber AI answer is ready (${took}).`, `Not in this text because ${withheldPublic}.`, link].join('\n')
    } else {
      const tldr = await composeTldr({
        question: args.question,
        answer: args.answer,
        userId: args.userId,
      })
      tldrSource = tldr.source

      /*
        ⚠ THE TLDR IS GUARDED IN ITS OWN RIGHT, THOUGH ITS SOURCE ALREADY PASSED.
        When it came from the model it is NEW prose, not a slice of the answer —
        it can name a thing the answer only alluded to, and §12's rule is that a
        security filter belongs at the choke point rather than being inferred
        from an earlier call on different text. Costs one query; the failure it
        prevents cannot be undone.
      */
      const verdict = await guardOutboundText(tldr.text)
      body = verdict.ok
        ? [tldr.text, link].join('\n\n')
        : [`Your Ber AI answer is ready (${took}).`, `Not in this text because ${withheldPublic}.`, link].join('\n')
      if (!verdict.ok) notes.push(`the bottom line was withheld: ${verdict.reason}`)
    }

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
    tldrSource,
    reason: notes.length ? `${headline} (${notes.join('; ')})` : headline,
  }
}
