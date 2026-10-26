/**
 * Did the email arrive? Asked from the RECIPIENT'S side.
 *
 * ⚠ THIS IS THE ASSERTION RICHARD'S 2026-10-26 DECISION REQUIRES. He chose
 * *"make email the channel that must arrive"* over two alternatives, and a
 * must-arrive channel nobody verifies is a promise, not a property. §12 wrote
 * the rule on this exact subject twice: *assert DELIVERY, not configuration*,
 * and *a backup is not a backup until it has been read back*.
 *
 * ⚠ AND EMAIL CAN BE ASSERTED POSITIVELY, WHICH THE TEXT CHANNEL NEVER COULD.
 * That asymmetry is the whole reason the decision is sound. The carrier gateway
 * returns no receipt, so `text-delivery.ts` can only report the ABSENCE of a
 * bounce — evidence, never proof. Here the platform holds a credential for the
 * recipient's own mailbox, so it can look in the inbox the message was sent to
 * and find the thing itself. That is proof of delivery, and it is the only
 * place in this system that can say so.
 *
 * What it reads: `notification_log` says what the platform BELIEVES it sent,
 * and the recipient's mailbox says what is actually there. The two together
 * answer the question; either alone is the trap — a send log that reads `sent`
 * is the claim under test, and an empty inbox search on a quiet week is not a
 * failure.
 */

import { listThreads, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { gatewaySender } from '@/lib/notify/text'
import { createAdminClient } from '@/lib/supabase/admin'

/** How far back a report reads. A week covers the weekday cadence twice over. */
const LOOKBACK_DAYS = 7

/**
 * Gmail indexes a sent message within seconds, but not instantly — and a
 * message sent in the last few minutes that is not yet searchable would read as
 * a loss. §12: a liveness check needs a clock.
 */
const INDEX_GRACE_MINUTES = 10

export type EmailVerdict = 'delivered' | 'missing' | 'pending' | 'quiet' | 'unknown'

export interface EmailDeliveryReport {
  /** The mailbox the notification was sent TO. */
  mailbox: string
  verdict: EmailVerdict
  /** What `notification_log` says the platform sent in the window. */
  claimed: number
  /** How many of those are findable in the recipient's own mailbox. */
  found: number
  lastSentAt: string | null
  summary: string
}

/**
 * The kinds this check can actually assert.
 *
 * ⚠ NAMED, NOT INFERRED, AND THE OMISSIONS ARE THE INTERESTING PART — a list
 * holding a kind the check cannot structurally see would be a check that cannot
 * fail, which is worse than no check (§12).
 *
 *   - `lead_handoff` is out because it goes to an outside crew whose mailbox
 *     this platform holds no credential for. It would read `missing` forever
 *     for mail that was delivered fine.
 *   - `agent_answer` is out for a different reason, verified against the table
 *     rather than assumed: its `notification_log` rows carry
 *     `team_member_id = NULL` and are keyed on the message id
 *     (`<id>:email` / `<id>:text`), because that pass needs per-CHANNEL
 *     idempotency rather than per-person. There is nothing to attribute to a
 *     mailbox, so including it would silently contribute nothing. It is also
 *     the one pass that does not need this: it reports `emailed`/`texted`
 *     straight back to the person who asked, while they are waiting.
 */
const MUST_ARRIVE_KINDS = ['task_week', 'task_due_today', 'record_alert', 'document_ready']

export async function reportEmailDelivery(
  opts: { now?: Date; mailboxes?: string[] } = {}
): Promise<EmailDeliveryReport[]> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)

  if (!isGoogleConfigured()) {
    return [
      {
        mailbox: '(none)',
        verdict: 'unknown',
        claimed: 0,
        found: 0,
        lastSentAt: null,
        summary: 'Google Workspace is not configured, so nothing can be asserted from a mailbox.',
      },
    ]
  }

  const supabase = createAdminClient()
  // The roster decides who is notified (since 10-26 the recipient list is the
  // PEOPLE, not whoever has a text handle), so it decides who is checked.
  const { data: members } = await supabase
    .from('team_members')
    .select('id, email')
    .eq('active', true)

  const sender = gatewaySender()
  const assistantSeat = sender.from.toLowerCase()
  const mailboxes =
    opts.mailboxes ??
    (members ?? [])
      .map((m) => (m.email ?? '').trim().toLowerCase())
      .filter((e) => e && e !== assistantSeat)

  const { data: logRows } = await supabase
    .from('notification_log')
    .select('team_member_id, kind, channel, status, created_at')
    .in('kind', MUST_ARRIVE_KINDS)
    .eq('status', 'sent')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500)

  const byMember = new Map<string, { kind: string; created_at: string }[]>()
  for (const r of logRows ?? []) {
    if (!r.team_member_id) continue
    // ⚠ ONLY A ROW THAT CLAIMED AN EMAIL CAN BE MISSING ONE, AND `channel` IS
    // WHAT SAYS SO. Without this the first live run read `missing` for Eric: a
    // `task_week` logged `sent` at 06:45 that morning, with no email in his
    // mailbox — correctly, because that run predated the change and was TEXT
    // ONLY. A verdict must not be computed over rows that predate the fact it
    // tests (§12, the mirror of re-asking one once the fact arrives). Keyed on
    // the recorded transport rather than a cutover date, so it needs no
    // maintenance and stays right if a kind ever drops back to one channel.
    if (!(r.channel ?? '').toLowerCase().includes('email')) continue
    const list = byMember.get(r.team_member_id) ?? []
    list.push({ kind: r.kind, created_at: r.created_at ?? '' })
    byMember.set(r.team_member_id, list)
  }

  const reports: EmailDeliveryReport[] = []
  for (const mailbox of mailboxes) {
    const member = (members ?? []).find((m) => (m.email ?? '').toLowerCase() === mailbox)
    const claims = member ? (byMember.get(member.id) ?? []) : []
    const lastSentAt = claims[0]?.created_at || null

    if (claims.length === 0) {
      reports.push({
        mailbox,
        verdict: 'quiet',
        claimed: 0,
        found: 0,
        lastSentAt: null,
        // ⚠ NOT AN 'ok'. A count that has stopped growing is indistinguishable
        // from a quiet week (§12), so this names the ambiguity.
        summary: `Nothing sent to ${mailbox} in ${LOOKBACK_DAYS} days — untested, not proven broken.`,
      })
      continue
    }

    const ageMinutes = lastSentAt ? (now.getTime() - new Date(lastSentAt).getTime()) / 60_000 : Infinity
    let found = 0
    try {
      // ⚠ SEARCHED BY SENDER, IN THE RECIPIENT'S OWN MAILBOX. Not by subject:
      // the subjects are composed per message and a subject match would be
      // testing the composer. The sender is the structural fact.
      //
      // ⚠ AND THE WINDOW STARTS AT THE MOST RECENT CLAIMED SEND, NOT AT THE
      // LOOKBACK. Reading the whole week reported `found 5` against `claimed 1`
      // on the first live run — it was counting every other thing `info@` had
      // ever sent that mailbox, so the check could pass on mail that had
      // nothing to do with the notification. A check that cannot fail is a
      // check nobody should read (§12). Anchored here, a message must be in
      // the mailbox dated on or after the thing we claim to have sent.
      const anchor = lastSentAt ? new Date(lastSentAt) : since
      // Gmail's `after:` takes a whole date, so this is widened to the start of
      // that day — the safe direction, and the alternative is no filter.
      const after = new Date(anchor.getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '/')
      const { threads } = await listThreads(mailbox, {
        q: `after:${after} from:${sender.from}`,
        maxResults: 100,
      })
      found = threads.length
    } catch (err) {
      reports.push({
        mailbox,
        verdict: 'unknown',
        claimed: claims.length,
        found: 0,
        lastSentAt,
        summary: `Could not read ${mailbox}: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    if (found > 0) {
      reports.push({
        mailbox,
        verdict: 'delivered',
        claimed: claims.length,
        found,
        lastSentAt,
        // Worded as what is actually known: the messages are IN the mailbox.
        summary:
          `${claims.length} notification(s) sent in ${LOOKBACK_DAYS} days; the latest is in ${mailbox} ` +
          `(${found} message(s) from ${sender.from} since it was sent). Read back from the recipient's ` +
          `own mailbox, so this is proof of delivery rather than evidence of it.`,
      })
      continue
    }

    if (ageMinutes < INDEX_GRACE_MINUTES) {
      reports.push({
        mailbox,
        verdict: 'pending',
        claimed: claims.length,
        found: 0,
        lastSentAt,
        summary: `Sent ${Math.round(ageMinutes)} min ago and not yet searchable — no verdict yet.`,
      })
      continue
    }

    reports.push({
      mailbox,
      verdict: 'missing',
      claimed: claims.length,
      found: 0,
      lastSentAt,
      summary:
        `⚠ ${claims.length} notification(s) are logged as sent to ${mailbox}, the latest at ` +
        `${lastSentAt}, but NOTHING from ${sender.from} is in that mailbox since. The channel that ` +
        `must arrive is not arriving.`,
    })
  }
  return reports
}
