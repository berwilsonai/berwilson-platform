/**
 * Outbound notification layer — one seam for every channel.
 *
 * Today only `email` is wired (via Microsoft Graph Mail.Send, reusing the
 * existing OAuth grant — no new vendor). A `telegram` channel can be added here
 * later behind the same `notify()` signature; callers (crons, digest builder)
 * never change. Keep this file the ONLY place that knows how a channel sends.
 */

import { sendMail } from '@/lib/integrations/microsoft-graph'

export type NotifyChannel = 'email' // | 'telegram' (future)

export interface NotifyOptions {
  channel: NotifyChannel
  /** Email address, or (future) a telegram chat id. */
  to: string
  subject: string
  html: string
}

export interface NotifyResult {
  ok: boolean
  error?: string
}

export async function notify(opts: NotifyOptions): Promise<NotifyResult> {
  try {
    switch (opts.channel) {
      case 'email':
        await sendMail({ to: opts.to, subject: opts.subject, html: opts.html })
        return { ok: true }
      default:
        return { ok: false, error: `Unsupported channel: ${opts.channel}` }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
