/**
 * Did the texts actually arrive? — asserted, not assumed.
 *
 * ⚠ §12 IS EXPLICIT ABOUT THIS AND THE RULE WAS WRITTEN BY THIS EXACT CHANNEL:
 * *a channel whose setup cannot be automated is a channel that is OFF, and
 * nothing says so. Assert DELIVERY, not configuration.* Pepper's text transport
 * failed silently for seven days — ten consecutive runs of `Couldn't find
 * shortcut "Pepper Text Richard"` — while every other part of the morning pass
 * reported success. The carrier email-to-SMS gateway replaced it on 10-19 and
 * works, but a gateway gives **no delivery receipt**, so the open item since
 * then has been *"say whether the texts arrived — your phone is the only test
 * there is"*. A platform that can only be verified by its owner looking at his
 * phone has not discharged the rule; it has moved it.
 *
 * WHAT THIS CAN AND CANNOT KNOW, STATED PLAINLY. A carrier that cannot deliver
 * to `<10 digits>@tmomail.net` bounces to the envelope sender, which is `info@`
 * — Pepper's own mailbox, the one box holding `gmail.modify`. So:
 *
 *   - a BOUNCE naming the gateway address is PROOF OF FAILURE, and that is a
 *     hard fact worth shouting about;
 *   - the ABSENCE of a bounce is EVIDENCE OF DELIVERY and nothing stronger —
 *     a handset that is off, a number that silently discards, or a carrier that
 *     drops without reporting all look identical from here.
 *
 * So the verdict is three-valued and says which it is. ⚠ It must never report
 * "delivered" from an absence: that is the `lmstudio-check` trap in a new place,
 * where a check that cannot fail is a check nobody should read. `delivered` here
 * means *sent, and the carrier did not reject it* — the wording the caller
 * prints says exactly that.
 *
 * ⚠ AND A CLOCK, NOT A COUNT (§12). A bounce arrives minutes after the send, so
 * a verdict is only meaningful once the window has passed; `sent_at` on
 * `pepper_outbound_texts` is that clock. A message sent four minutes ago is
 * `pending`, never `delivered`.
 */

import { provDb } from '@/lib/provenance/db'
import { gatewayAddress, textTargets } from '@/lib/notify/text'

/** How long a carrier gets to bounce before silence counts as evidence. */
const BOUNCE_WINDOW_MINUTES = 90

/** How far back a report reads. A week covers the weekday cadence twice over. */
const LOOKBACK_DAYS = 7

export type DeliveryVerdict = 'no_bounce' | 'bounced' | 'pending' | 'not_configured'

export interface TextDeliveryReport {
  handle: string
  /** The person, by the address their target entry is keyed on. */
  email: string
  gateway: string | null
  verdict: DeliveryVerdict
  /** How many texts went to this handle inside the lookback window. */
  sent: number
  /** The newest send, so a reader can tell a quiet week from a broken channel. */
  lastSentAt: string | null
  /** The bounce subject, when there is one — the only hard evidence here. */
  bounce: string | null
  /** One sentence a reader can act on. */
  summary: string
}

/**
 * Bounce subjects, as the big providers actually word them.
 *
 * Matched on the SUBJECT because a bounce's body is a MIME report and reading it
 * means parsing `message/delivery-status`; the subject is enough to raise a flag
 * that a human then reads. ⚠ Broad on purpose: a false positive costs a
 * "check this" line in the morning note, a false negative costs the channel
 * going dark again for a week.
 */
const BOUNCE_SUBJECTS = [
  'Delivery Status Notification',
  'Undelivered Mail Returned to Sender',
  'Mail delivery failed',
  'Returned mail',
  'Delivery incomplete',
  'failure notice',
]

/**
 * Has anything bounced for this gateway address?
 *
 * Searches `info@` — the mailbox the gateway sends AS, and therefore the one a
 * bounce returns to. Read-only: this needs no write scope, which matters
 * because it must keep working if the scope tiering in §12 ever tightens.
 */
async function findBounce(gateway: string, since: Date): Promise<string | null> {
  const { listThreads, isGoogleConfigured } = await import(
    '@/lib/integrations/google-workspace'
  )
  if (!isGoogleConfigured()) throw new Error('Google Workspace is not configured')
  const mailbox = process.env.PEPPER_TEXT_FROM || 'info@berwilson.com'

  // ⚠ THE SUBJECT MATCH IS DONE BY GMAIL, NOT BY US, so a hit IS a bounce and
  // there is no snippet to parse. `listThreads` returns snippets rather than
  // subjects, so filtering client-side would mean one `fetchThread` per
  // candidate — and Gmail meters by cost-units-per-MINUTE (§12), which a
  // per-thread fan-out is the fastest way to exhaust.
  //
  // Gmail's `after:` takes a whole date, so the window is widened to days; that
  // only makes the search broader, and breadth is the safe direction here.
  const after = new Date(since.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '/')
  const subjects = BOUNCE_SUBJECTS.map((s) => `"${s}"`).join(' OR ')
  const q = `after:${after} "${gateway}" subject:(${subjects})`

  // A failed search must NOT read as "nothing bounced" — that is the false
  // green this module exists to prevent — so the throw propagates and the
  // caller reports `pending` with the reason.
  const { threads } = await listThreads(mailbox, { q, maxResults: 10 })
  if (threads.length === 0) return null
  // The snippet is only used to SAY something useful about a bounce Gmail has
  // already identified, never to decide whether it is one.
  return threads[0].snippet?.trim().slice(0, 120) || 'a delivery failure notice'
}

/**
 * One report per configured text target.
 *
 * Reads `pepper_outbound_texts`, which already exists as the self-loop guard —
 * every text Pepper sends writes a row there before it goes out, so it is also
 * a complete send log and needed no new table.
 */
export async function reportTextDelivery(
  opts: { now?: Date } = {}
): Promise<TextDeliveryReport[]> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
  const { targets } = textTargets()
  if (targets.length === 0) return []

  const { data } = await provDb()
    .from('pepper_outbound_texts')
    .select('handle, sent_at, kind')
    .gte('sent_at', since.toISOString())
    .order('sent_at', { ascending: false })
    .limit(500)
  const sends = (data ?? []) as Array<{ handle: string; sent_at: string | null }>

  const reports: TextDeliveryReport[] = []
  for (const target of targets) {
    const mine = sends.filter((s) => s.handle === target.handle)
    const lastSentAt = mine[0]?.sent_at ?? null
    const gateway = gatewayAddress(target)

    if (!gateway) {
      reports.push({
        handle: target.handle,
        email: target.email,
        gateway: null,
        verdict: 'not_configured',
        sent: mine.length,
        lastSentAt,
        bounce: null,
        summary:
          'No carrier gateway configured, so this goes over the hand-built Shortcut — ' +
          'the transport that delivered nothing for seven days. Set PEPPER_TEXT_GATEWAY_DOMAIN.',
      })
      continue
    }

    if (mine.length === 0) {
      reports.push({
        handle: target.handle,
        email: target.email,
        gateway,
        verdict: 'pending',
        sent: 0,
        lastSentAt: null,
        bounce: null,
        // ⚠ A COUNT THAT HAS STOPPED GROWING IS INDISTINGUISHABLE FROM A QUIET
        // WEEK (§12), so this says which question is unanswered rather than
        // pretending to a verdict.
        summary: `Nothing sent to ${target.handle} in ${LOOKBACK_DAYS} days — the channel is untested, not broken.`,
      })
      continue
    }

    const ageMinutes = lastSentAt
      ? (now.getTime() - new Date(lastSentAt).getTime()) / 60_000
      : Infinity
    if (ageMinutes < BOUNCE_WINDOW_MINUTES) {
      reports.push({
        handle: target.handle, email: target.email, gateway,
        verdict: 'pending', sent: mine.length, lastSentAt, bounce: null,
        summary: `Sent ${Math.round(ageMinutes)} min ago — a bounce can still arrive, so no verdict yet.`,
      })
      continue
    }

    let bounce: string | null = null
    try {
      bounce = await findBounce(gateway, since)
    } catch (err) {
      reports.push({
        handle: target.handle, email: target.email, gateway,
        verdict: 'pending', sent: mine.length, lastSentAt, bounce: null,
        summary: `Could not read ${gateway}'s bounces: ${
          err instanceof Error ? err.message : String(err)
        }`,
      })
      continue
    }

    reports.push({
      handle: target.handle,
      email: target.email,
      gateway,
      verdict: bounce ? 'bounced' : 'no_bounce',
      sent: mine.length,
      lastSentAt,
      bounce,
      summary: bounce
        ? `⚠ THE CARRIER REJECTED IT: "${bounce}". ${target.handle} is not receiving texts.`
        : // Worded as what is actually known. "Delivered" would be a claim this
          // cannot support — see the header.
          `${mine.length} sent in ${LOOKBACK_DAYS} days, none rejected by the carrier. ` +
          `That is evidence of delivery, not proof — a gateway returns no receipt.`,
    })
  }
  return reports
}

/** One line for the morning note, or null when there is nothing worth saying. */
export function describeTextDelivery(reports: TextDeliveryReport[]): string | null {
  const bounced = reports.filter((r) => r.verdict === 'bounced')
  if (bounced.length > 0) {
    return `⚠ Texts are being REJECTED for ${bounced
      .map((r) => `${r.handle} (${r.bounce})`)
      .join(', ')} — nothing I send by text is reaching them.`
  }
  const unconfigured = reports.filter((r) => r.verdict === 'not_configured')
  if (unconfigured.length > 0) {
    return `⚠ ${unconfigured.length} text target(s) have no carrier gateway and fall back to the Shortcut transport, which has never delivered.`
  }
  const untested = reports.filter((r) => r.verdict === 'pending' && r.sent === 0)
  if (untested.length === reports.length && reports.length > 0) {
    return `No texts sent in the last ${LOOKBACK_DAYS} days — the channel is untested.`
  }
  // Silence is the good case and does not need a line every morning.
  return null
}
