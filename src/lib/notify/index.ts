/**
 * Outbound notification layer — one seam for every channel.
 *
 * Three channels are wired: `email` (Gmail users.messages.send), `chat`
 * (a Google Chat incoming webhook) and `text` (iMessage, sent by the Studio
 * itself through the Shortcuts CLI). The first two reuse infrastructure the
 * Workspace already provides — no new vendor, no new account for anyone to
 * create; the third adds no vendor either, which is the whole reason it is
 * built the awkward way it is (see ./text).
 * Keep this file the ONLY place that knows how a channel sends.
 *
 * ⚠ EVERY CALLER NAMES ITS `kind`, AND THE KIND DECIDES WHETHER ANYTHING IS
 * SENT AT ALL. `src/lib/notify/policy.ts` holds the enumeration and the on/off
 * beside it; this function consults it before it touches a transport, so a pass
 * that is held costs nothing and a kind the policy does not know sends nothing.
 * Required rather than optional on purpose — `tsc` names every caller that has
 * not been thought about, which is the only way an enumeration like this stays
 * honest (§12).
 *
 * ⚠ `text` IS NOT A SHORTER EMAIL. It takes `opts.text` and sends exactly that
 * — no subject line, no HTML conversion. A subject rendered as a text's first
 * line reads as a header on a message that has no room for one, and converting
 * HTML would put link wrappers and list markup on a phone. A caller that wants
 * a text writes the text.
 */

import { sendMail, type MailAttachment } from '@/lib/integrations/google-workspace'
import { htmlToChatText, sendChat } from './chat'
import { outboundAllowed, type OutboundKind } from './policy'
import { sendText, textTargets, type TextKind } from './text'

export type NotifyChannel = 'email' | 'chat' | 'text'

export interface NotifyOptions {
  channel: NotifyChannel
  /**
   * WHICH PASS THIS IS. Gates the send through `./policy` and never defaults.
   *
   * ⚠ NOT the same field as `textKind`, and they are deliberately not merged:
   * this says which PASS is speaking (one row in the policy table, one on/off),
   * while `textKind` says which MESSAGE it is in the self-loop ledger — the
   * morning text is one pass and two messages ('morning', 'week_ahead').
   */
  kind: OutboundKind
  /** Email address, or — for chat — a webhook URL or a configured space key. */
  to: string
  subject: string
  html: string
  /**
   * Plain body for channels that cannot render HTML. Chat has its own small
   * markup dialect, so a caller that cares about how the message reads supplies
   * this; otherwise the HTML is converted, which is serviceable but blunter.
   */
  text?: string
  /** Email only. Ignored by channels that cannot carry files. */
  attachments?: MailAttachment[]
  /**
   * Email only. Which mailbox the message is sent AS, and the display name on
   * it. Defaults to the platform sender.
   *
   * Exposed because a message from a named assistant is a different object from
   * a system notification: the morning note arrived From "Ber Intelligence
   * <moose@berwilson.com>" — that is Richard's own address, so his own note
   * looked like mail he had sent himself. The sending mailbox must hold
   * gmail.send; one that does not fails loudly rather than falling back.
   */
  from?: string
  fromName?: string
  /** Chat only. Groups related posts into one thread in the space. */
  threadKey?: string
  /**
   * Text only. Record the self-loop guard row and decide everything, but do not
   * hand the body to a transport. Exposed so a pass that composes a message can
   * be verified end to end without a phone buzzing.
   */
  dryRun?: boolean
  /**
   * Text only. Which kind of message this is, for the send record. Defaults to
   * 'ad_hoc' so a caller that forgets still gets a guard row — the guard is
   * what stops the sweep reading our own texts back as obligations, and it must
   * never be optional in practice.
   */
  textKind?: TextKind
  /**
   * Email channel only: reply INTO this Gmail thread rather than starting one.
   *
   * ⚠ NOT `threadKey`, which is the Chat channel's unrelated grouping string.
   * Named apart deliberately; one field serving both would thread a Chat post
   * into a Gmail conversation the first time somebody passed the wrong one.
   */
  threadId?: string
  /** Email channel only: Message-ID of the message being answered. */
  inReplyTo?: string | null
}

export interface NotifyResult {
  ok: boolean
  error?: string
  /**
   * True when nothing was sent because `./policy` holds this kind.
   *
   * ⚠ IT IS NOT AN ERROR AND MUST NOT BE LOGGED AS A FAILED SEND. A caller that
   * can be held should ask `isHeld()` before it assembles anything; this flag is
   * the backstop for the one that forgets, and it exists so a `notification_log`
   * row says "held" rather than "failed" — a week of fake failures is how a
   * health card stops meaning anything.
   */
  held?: boolean
  /**
   * Gmail's ids for the message, on the email channel only.
   *
   * Carried so a caller can remember what Pepper sent — which is how a REPLY
   * to one of her messages is recognised later, without asking a human to
   * remember a subject convention on a phone. Absent on every other channel.
   */
  sent?: { id: string; threadId: string }
  /**
   * Text channel only: which transport carried it — the carrier gateway or the
   * on-box Shortcut. Two transports that can silently swap places need the log
   * to say which one answered.
   */
  via?: 'gateway' | 'shortcut'
}

export async function notify(opts: NotifyOptions): Promise<NotifyResult> {
  const verdict = outboundAllowed(opts.kind)
  if (!verdict.allowed) {
    return { ok: false, held: true, error: verdict.reason }
  }

  try {
    switch (opts.channel) {
      case 'email': {
        const sent = await sendMail({
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          attachments: opts.attachments,
          from: opts.from,
          fromName: opts.fromName,
          threadId: opts.threadId,
          inReplyTo: opts.inReplyTo,
        })
        return { ok: true, sent }
      }
      case 'chat':
        await sendChat(
          opts.to,
          // The subject is the message's first line in a space — Chat has no
          // subject of its own, and an unheaded wall of text scrolls past.
          `*${opts.subject}*\n\n${opts.text ?? htmlToChatText(opts.html)}`,
          opts.threadKey
        )
        return { ok: true }
      case 'text': {
        if (!opts.text?.trim()) {
          return { ok: false, error: 'the text channel requires opts.text' }
        }
        // `to` is the team member's address, which is how every caller already
        // addresses a person. The handle and the shortcut come from config, so
        // no caller anywhere holds a phone number.
        const { targets, problems } = textTargets()
        const target = targets.find((t) => t.email === opts.to.toLowerCase())
        if (!target) {
          const detail = problems.length ? ` (${problems.join('; ')})` : ''
          return {
            ok: false,
            error: `no text target configured for ${opts.to}${detail} — set PEPPER_TEXT_TARGETS`,
          }
        }
        const result = await sendText({
          target,
          body: opts.text,
          // The ledger kind, which defaults to the pass's own name when that
          // name is one the ledger accepts. A caller sending two shapes of
          // message from one pass says which.
          kind: opts.textKind ?? defaultTextKind(opts.kind),
          dryRun: opts.dryRun,
        })
        return result.ok ? { ok: true, via: result.via } : { ok: false, error: result.error }
      }
      default:
        return { ok: false, error: `Unsupported channel: ${opts.channel}` }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * The self-loop ledger's kind for a pass that did not name one.
 *
 * ⚠ THE LEDGER'S VALUE SET IS A CHECK CONSTRAINT ON `pepper_outbound_texts`,
 * so this may only return a member of it — a plausible-but-wrong value fails
 * the whole INSERT (§12), and `sendText` REFUSES to send without the guard row.
 * Hence the explicit list rather than a cast: a new policy kind that texts has
 * to be added here and to the constraint in the same change.
 */
function defaultTextKind(kind: OutboundKind): TextKind {
  switch (kind) {
    case 'task_week':
      return 'task_week'
    case 'task_due_today':
      return 'task_due_today'
    case 'record_alert':
      return 'record_alert'
    case 'meeting_prep':
      return 'nudge'
    case 'pepper_answer':
      return 'reply'
    default:
      return 'ad_hoc'
  }
}
