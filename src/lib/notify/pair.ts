/**
 * One message, two envelopes — and only ONE of them has to arrive.
 *
 * ⚠ RICHARD'S DECISION, 2026-10-26: *"Make email the channel that must
 * arrive."* He was choosing between three options after the measurement below,
 * and this module is that choice expressed once rather than four times.
 *
 * WHY THERE WAS A CHOICE. The text transport is a carrier email-to-SMS gateway
 * (`info@` → `<10 digits>@tmomail.net`), and on 2026-10-26 a read of `info@`'s
 * own Sent folder found T-Mobile rejecting it: **13 texts in 30 days, 6 delayed
 * and 1 permanently failed**, every rejection the same string from their MTA —
 * `452 4.1.0 <info@berwilson.com> server temporarily unavailable AUP#MXRT`. It
 * names our SENDER, not the handles, so it hits both executives, and Gmail
 * retries a delayed message for 21–46 hours. The real behaviour of that channel
 * is therefore: some arrive, some arrive a day late, and some never arrive.
 * Nothing in this repo can fix a carrier's acceptable-use block.
 *
 * SO THE TWO CHANNELS NOW HAVE DIFFERENT STANDING, AND THAT IS THE WHOLE POINT:
 *
 *   - **email MUST arrive.** It is sent FIRST and its failure is the pass's
 *     failure — the thing a cron reports, a `notification_log` row records as
 *     `failed`, and a health card goes red over.
 *   - **text is BEST-EFFORT.** It is still sent, because it is instant and it
 *     is on the phone, but its failure is a NOTE and never a failure. A carrier
 *     block must not make a morning read as broken when the reminder did in
 *     fact land.
 *
 * ⚠ AND THE RECIPIENT LIST MUST NOT BE GATED ON A TEXT HANDLE ANY MORE. That
 * inversion is the bug this module exists to prevent: `record_alert` used to
 * iterate `textTargets()`, so an empty `PEPPER_TEXT_TARGETS` — or a person with
 * no handle — meant NOBODY was told that a recording had created a deal. Once
 * email is the channel that must arrive, the list is the PEOPLE; a handle is an
 * optional extra one of them happens to have.
 *
 * ⚠ IT SENDS AS `info@`, AND THAT IS STRUCTURAL RATHER THAN COSMETIC. Pepper
 * emailing a deal mailbox puts her own words where the sweep reads them, which
 * is the 2026-10-09 failure exactly (131 of 481 open commitments were Pepper
 * reading her own morning notes). `isPlatformMail` in
 * `src/lib/email-sweep/prefilter.ts` skips a thread whose every message comes
 * from the assistant seat — keyed on the ADDRESS, so no display name can
 * reopen it, and a human reply rescues the thread. Sending as `moose@` instead
 * would be Richard's own address and would defeat that guard.
 */

import { notify, type NotifyResult } from '@/lib/notify'
import type { OutboundKind } from '@/lib/notify/policy'
import { gatewaySender, signAsPepper, textTargets, type TextKind } from '@/lib/notify/text'

export interface PairResult {
  /** The channel that had to arrive. */
  emailed: boolean
  /** The best-effort one. */
  texted: boolean
  /**
   * The EMAIL's error, and nothing else.
   *
   * ⚠ A TEXT FAILURE IS DELIBERATELY NOT AN ERROR HERE. A caller writes its
   * `notification_log` status from this field, so folding the text's failure in
   * would mark a morning `failed` that the person actually received — and then
   * a re-run would send it twice.
   */
  error: string | null
  /** What became of the text, for the log and the cron's own response. */
  textNote: string | null
  /** Which transport carried the text, when one did. */
  via?: 'gateway' | 'shortcut'
  /** Gmail's ids for the email, so a reply can be recognised later. */
  sent?: { id: string; threadId: string }
}

/**
 * Plain text rendered as the body of an email.
 *
 * These messages are composed as texts — short lines, facts, a bare URL — so
 * the email is the same words made readable rather than a second composition.
 * ⚠ ONE RENDERER FOR ALL OF THEM, because the alternative is three bespoke
 * templates that drift from the text they are supposed to mirror (§12).
 *
 * The bare URL is the one thing that must change: a text's reader taps it and a
 * mail reader cannot, so it becomes a real anchor.
 */
export function textToEmailHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Trailing punctuation is excluded from the href: a sentence ending in a URL
  // is common in these bodies and ".</p>" inside a link is a broken link.
  const linked = escaped.replace(
    /https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g,
    (url) => `<a href="${url}">${url}</a>`
  )
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
    `font-size:15px;line-height:1.55;color:#1a1a1a">` +
    linked.replace(/\n/g, '<br>') +
    `</div>`
  )
}

/** True when this address has a text handle configured. Never throws. */
export function hasTextTarget(email: string): boolean {
  try {
    const { targets } = textTargets()
    return targets.some((t) => t.email === email.trim().toLowerCase())
  } catch {
    return false
  }
}

/**
 * Send one notification by email (must arrive) and by text (best-effort).
 *
 * ⚠ EMAIL FIRST, AND THE ORDER IS THE POLICY. If the text went first, a carrier
 * that hangs for 60 seconds would delay the channel carrying the obligation —
 * and on a failure the caller could not tell which half it was waiting on.
 */
export async function notifyPair(opts: {
  kind: OutboundKind
  /** The person. Their work mailbox; the text handle is looked up from it. */
  to: string
  /** The EMAIL's subject. The text channel uses its own (see `gatewaySender`). */
  subject: string
  /** The message as plain text — sent verbatim as the text, rendered for mail. */
  text: string
  /** Richer mail body, when a caller has one. Omitted = `textToEmailHtml`. */
  html?: string
  textKind?: TextKind
  dryRun?: boolean
}): Promise<PairResult> {
  const out: PairResult = { emailed: false, texted: false, error: null, textNote: null }

  const body = opts.text.trim()
  if (!body) {
    out.error = 'empty message — nothing was sent on either channel'
    return out
  }

  // ── The channel that must arrive ─────────────────────────────────────────
  //
  // ⚠ SIGNED THE SAME WAY THE TEXT IS. Richard asked for texts from `info@`
  // signed as Pepper on this same day; an email arriving from the same seat
  // unsigned would be the drift §12 warns about — one message, two envelopes,
  // one voice. `signAsPepper` is idempotent, so a body that signs itself (the
  // record alert does) is untouched.
  const sender = gatewaySender()
  const emailBody = opts.html ?? textToEmailHtml(signAsPepper(body))
  const email: NotifyResult = await notify({
    kind: opts.kind,
    channel: 'email',
    to: opts.to,
    subject: opts.subject,
    html: emailBody,
    from: sender.from,
    fromName: sender.fromName,
  }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))

  if (email.ok) {
    out.emailed = true
    out.sent = email.sent
  } else if (email.held) {
    // A held kind is not a failure (§12 / policy.ts) and must not read as one.
    out.textNote = `email held: ${email.error ?? 'held'}`
  } else {
    out.error = email.error ?? 'unknown email failure'
  }

  // ── The best-effort one ──────────────────────────────────────────────────
  //
  // Attempted even when the email failed: two independent transports, and the
  // one that still works should still carry the message.
  if (!hasTextTarget(opts.to)) {
    out.textNote = joinNotes(out.textNote, 'no text handle configured for this person')
    return out
  }

  const text: NotifyResult = await notify({
    kind: opts.kind,
    channel: 'text',
    to: opts.to,
    subject: sender.subject,
    html: '',
    text: body,
    textKind: opts.textKind,
    dryRun: opts.dryRun,
  }).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))

  if (text.ok) {
    out.texted = true
    out.via = text.via
  } else {
    // ⚠ NOT `out.error`. See `PairResult.error`.
    out.textNote = joinNotes(
      out.textNote,
      `text not delivered (best-effort channel): ${text.error ?? 'unknown'}`
    )
  }
  return out
}

function joinNotes(a: string | null, b: string): string {
  return a ? `${a}; ${b}` : b
}
