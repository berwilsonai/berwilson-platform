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
 * ⚠ `text` IS NOT A SHORTER EMAIL. It takes `opts.text` and sends exactly that
 * — no subject line, no HTML conversion. A subject rendered as a text's first
 * line reads as a header on a message that has no room for one, and converting
 * HTML would put link wrappers and list markup on a phone. A caller that wants
 * a text writes the text.
 */

import { sendMail, type MailAttachment } from '@/lib/integrations/google-workspace'
import { htmlToChatText, sendChat } from './chat'
import { sendText, textTargets, type TextKind } from './text'

export type NotifyChannel = 'email' | 'chat' | 'text'

export interface NotifyOptions {
  channel: NotifyChannel
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
   * Text only. Which kind of message this is, for the send record. Defaults to
   * 'ad_hoc' so a caller that forgets still gets a guard row — the guard is
   * what stops the sweep reading our own texts back as obligations, and it must
   * never be optional in practice.
   */
  textKind?: TextKind
}

export interface NotifyResult {
  ok: boolean
  error?: string
}

export async function notify(opts: NotifyOptions): Promise<NotifyResult> {
  try {
    switch (opts.channel) {
      case 'email':
        await sendMail({
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          attachments: opts.attachments,
          from: opts.from,
          fromName: opts.fromName,
        })
        return { ok: true }
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
          kind: opts.textKind ?? 'ad_hoc',
        })
        return result.ok ? { ok: true } : { ok: false, error: result.error }
      }
      default:
        return { ok: false, error: `Unsupported channel: ${opts.channel}` }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
