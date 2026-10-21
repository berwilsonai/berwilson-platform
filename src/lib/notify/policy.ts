/**
 * WHICH OUTBOUND MESSAGES ARE ALLOWED TO LEAVE, ENUMERATED IN ONE PLACE.
 *
 * Richard, 2026-10-21: *"Lets have pepper hold off on the emails and chat's for
 * now. I like that the functionality is there, but the content isn't really
 * helpful at this point. The only messaging I want to go out are reminder of
 * important tasks that have a due date that week. Send it out Monday. You can
 * send a reminder the day of if it still hasn't been checked off the tasks
 * list."*
 *
 * ⚠ HELD, NOT DELETED. Every pass below still assembles, still renders and
 * still has its tests; what it does not do is send. The content was judged, not
 * the machinery — so the undo is one word in this table, and a held pass is
 * REPORTED (on /settings/health and in its own cron response) rather than
 * silently doing nothing. §12: a channel that is off while nothing says so is
 * the failure this project has already paid for once, when seven days of
 * morning texts went to nobody and every run reported success.
 *
 * ⚠ THE GATE IS A DEFAULT AT THE CHOKE POINT, NOT A PARAMETER EACH CALLER
 * PASSES. §12's rule about security filters applies to a quiet policy for the
 * same reason: forgetting to opt in costs a message, forgetting to opt out
 * sends one nobody asked for — and the default has to cover the pass somebody
 * writes next year. `notify()` requires a `kind`, every kind is a key in this
 * table, and a kind this file does not know is HELD.
 *
 * ⚠ A HUMAN PRESSING A BUTTON IS NOT "MESSAGING GOING OUT". `lead_handoff` is
 * the only `human` trigger here and it stays live: it fires when somebody
 * clicks Hand off on /leads or approves a lane on /decide, it carries an
 * inbound trade lead to the crew that does the work — people with no login and
 * no other way to be reached — and holding it would mean a button that does
 * nothing. That distinction is §11's own invariant (automatic vs. human
 * confirm), not a new one. Say the word and it becomes `live: false` like the
 * rest.
 */

export type OutboundTrigger =
  /** A launchd cron decides when. Nobody asked for this message today. */
  | 'scheduled'
  /** Something arrived — a recording, a reply — and the pass answers it. */
  | 'event'
  /** Somebody pressed a button and is waiting for the result. */
  | 'human'

interface OutboundPassBase {
  /** What the message is, in the words its reader would use. */
  what: string
  channel: 'email' | 'chat' | 'text'
  trigger: OutboundTrigger
}

/**
 * ⚠ A UNION, SO THAT HOLDING SOMETHING WITHOUT SAYING WHY DOES NOT COMPILE.
 * `held?: string` would let a future row be switched off with no explanation,
 * and an unexplained silence is the whole failure mode this file exists to
 * prevent — §12: a channel that is off while nothing says so. The reason is
 * printed on the health card and in the cron's own response, so it has to exist.
 */
export type OutboundPass =
  | (OutboundPassBase & { live: true })
  | (OutboundPassBase & { live: false; held: string })

/**
 * ⚠ ONE ROW PER KIND, AND THE KEYS ARE THE `notification_log.kind` STRINGS
 * where a pass writes one — so a card, a cron and this table cannot disagree
 * about what a channel is called.
 */
export const OUTBOUND = {
  // ── Live ──────────────────────────────────────────────────────────────────
  task_week: {
    what: "Monday's reminder of the tasks due this week",
    channel: 'text',
    trigger: 'scheduled',
    live: true,
  },
  task_due_today: {
    what: 'the day-of reminder for a task still not checked off',
    channel: 'text',
    trigger: 'scheduled',
    live: true,
  },
  record_alert: {
    what: 'the TLDR text when a recording created a project or opportunity',
    channel: 'text',
    trigger: 'event',
    live: true,
  },
  lead_handoff: {
    what: 'an inbound trade lead emailed to the crew that does the work',
    channel: 'email',
    trigger: 'human',
    live: true,
  },
  /**
   * ⚠ LIVE UNDER THE SAME RULE AS `lead_handoff`, AND CONFIRMED BY RICHARD ON
   * 2026-10-21 AFTER THE HOLD ABOVE WAS ALREADY DECIDED. He was asked directly,
   * because the two instructions landed the same day in two sessions and only
   * he could say which governs: *"Send it — I asked the question."*
   *
   * This is the header's distinction doing its job. Pepper's held passes all
   * arrive unbidden on a schedule, and the judgement was about their CONTENT
   * not earning the slot. An answer is the opposite on every axis: he typed
   * the question, he is waiting for it, and it only sends at all when the turn
   * ran past 90 seconds — i.e. precisely when he has given up watching and
   * gone to do something else. Holding it would mean a question that answers
   * itself into a void.
   */
  agent_answer: {
    what: 'the answer to a Ber AI question that took long enough for you to walk away',
    channel: 'email',
    trigger: 'human',
    live: true,
  },

  // ── Held 2026-10-21 ───────────────────────────────────────────────────────
  pepper_note: {
    what: "Pepper's per-person morning note",
    channel: 'email',
    trigger: 'scheduled',
    live: false,
    held: 'The content was not earning the 06:50 slot. The note still assembles and renders; it sends nothing.',
  },
  pepper_text: {
    what: "Pepper's morning text, and the Monday week-ahead",
    channel: 'text',
    trigger: 'scheduled',
    live: false,
    held: 'Replaced on this channel by task_week / task_due_today, which say one thing.',
  },
  pepper_answer: {
    what: 'Pepper answering a question emailed to her',
    channel: 'email',
    trigger: 'event',
    live: false,
    held: 'Held with the rest of her mail. The inbound half still reads and logs the question, so nothing is lost by turning it back on.',
  },
  meeting_prep: {
    what: 'the nudge ~20 minutes before an external meeting',
    channel: 'email',
    trigger: 'scheduled',
    live: false,
    held: 'Held with the rest of her mail.',
  },
  daily_digest: {
    what: "the morning digest posted to the Chat space",
    channel: 'chat',
    trigger: 'scheduled',
    live: false,
    held: 'Held. It is still generated and stored, so /dashboard and Ber AI keep reading it.',
  },
  weekly_brief: {
    what: 'the Monday portfolio brief posted to the Chat space',
    channel: 'chat',
    trigger: 'scheduled',
    live: false,
    held: 'Held. Still written to stored_briefs, which is where the dashboard reads it.',
  },
  activity_broadcast: {
    what: 'activity notifications mirrored into the Chat space',
    channel: 'chat',
    trigger: 'event',
    live: false,
    held: 'Held. The in-app bell still gets every row.',
  },
  lead_digest: {
    what: 'the digest of scored leads to LEADS_NOTIFY_EMAIL and Chat',
    channel: 'email',
    trigger: 'scheduled',
    live: false,
    held: 'Held. The /leads queue and /decide still fill, and notified_at is left unstamped so nothing is skipped when this comes back.',
  },

  /**
   * The escape hatch, and it is HELD on purpose.
   *
   * `notify()` used to default a missing text kind to `ad_hoc` so a forgetful
   * caller still got a self-loop guard row. That default is now this row, which
   * means a pass that does not name itself is silent rather than unattributed —
   * the §12 shape of "make the parameter explicit so a job that forgets gets
   * the SAFE behaviour".
   */
  ad_hoc: {
    what: 'a message from a pass that did not name itself',
    channel: 'text',
    trigger: 'event',
    live: false,
    held: 'Unnamed sends are held by construction. Add a kind to this table instead of using this one.',
  },
} as const satisfies Record<string, OutboundPass>

export type OutboundKind = keyof typeof OUTBOUND

export interface OutboundVerdict {
  allowed: boolean
  /** In words, for a log line or a health card. Always populated. */
  reason: string
}

/**
 * May this kind of message leave?
 *
 * ⚠ FAILS CLOSED ON A KIND IT DOES NOT KNOW — including `undefined`, which is
 * what a JavaScript caller outside TypeScript's reach would hand it.
 */
export function outboundAllowed(kind: OutboundKind | string | undefined): OutboundVerdict {
  if (!kind || !(kind in OUTBOUND)) {
    return {
      allowed: false,
      reason: `held: "${kind ?? 'none'}" is not a kind src/lib/notify/policy.ts knows, and an unknown kind does not send`,
    }
  }
  const pass = OUTBOUND[kind as OutboundKind]
  if (pass.live) return { allowed: true, reason: pass.what }
  return { allowed: false, reason: `held: ${pass.held}` }
}

/** True when this kind is enumerated and switched off — the common question. */
export function isHeld(kind: OutboundKind): boolean {
  return !OUTBOUND[kind].live
}

/** Every held kind, for a health card that has to say what is quiet. */
export function heldKinds(): OutboundKind[] {
  return (Object.keys(OUTBOUND) as OutboundKind[]).filter((k) => !OUTBOUND[k].live)
}

/** Every kind that can still send. */
export function liveKinds(): OutboundKind[] {
  return (Object.keys(OUTBOUND) as OutboundKind[]).filter((k) => OUTBOUND[k].live)
}

/**
 * One sentence naming what is quiet, for a reader who did not read this file.
 *
 * ⚠ IT NAMES THEM RATHER THAN COUNTING THEM. "8 channels held" is the kind of
 * number §12 warns about: it tells the reader they are behind and nothing else.
 */
export function heldSummary(): string {
  const held = heldKinds().filter((k) => k !== 'ad_hoc')
  if (held.length === 0) return 'Every channel is live.'
  return `Held since 2026-10-21: ${held.map((k) => OUTBOUND[k].what).join('; ')}.`
}
