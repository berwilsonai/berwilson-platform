/**
 * Outbound notification layer — one seam for every channel.
 *
 * Two channels are wired: `email` (Gmail users.messages.send) and `chat`
 * (a Google Chat incoming webhook). Both reuse infrastructure the Workspace
 * already provides — no new vendor, no new account for anyone to create.
 * Keep this file the ONLY place that knows how a channel sends.
 */

import { sendMail, type MailAttachment } from '@/lib/integrations/google-workspace'
import { htmlToChatText, sendChat } from './chat'

export type NotifyChannel = 'email' | 'chat'

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
  /** Chat only. Groups related posts into one thread in the space. */
  threadKey?: string
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
      default:
        return { ok: false, error: `Unsupported channel: ${opts.channel}` }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
