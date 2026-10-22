/**
 * Vocabulary for the inbound lead queue — labels and badge tones for routes,
 * statuses, and fit recommendations.
 *
 * Plain text in the DB with the app as source of truth, matching the steel and
 * opportunities modules. Badge strings follow the Chip contract: a
 * bg/text/ring triple with dark variants.
 */

import { enumLabel } from '@/lib/utils/constants'
import type { LeadStatus, FitRecommendation, LeadSource } from '@/lib/leads/db'
import { chipTone } from '@/lib/ui/tone'

/**
 * What a lead of a category becomes when a human accepts it.
 *
 * Defined HERE rather than in `src/lib/leads/categories.ts` so the dependency
 * points the right way: this module is pure and imported by client components,
 * the registry holds the service-role client and is server-only. The registry
 * imports this type; nothing imports the registry from the browser.
 */
export type LeadDestination = 'project' | 'opportunity' | 'steel_deal' | 'handoff' | 'manual'

/**
 * A handoff lane as the SIDEBAR needs it — a key and a label, nothing else.
 *
 * Here rather than exported from `AppSidebar.tsx` for the same reason as
 * `LeadCategoryView` above: the layout is a server component, and a type
 * imported out of a `'use client'` file invites a value to follow it one day
 * (§12). Narrower than `LeadCategoryView` on purpose — a nav row renders a
 * label and a link, and nothing in the menu should depend on more than that.
 */
export interface LeadLane {
  key: string
  label: string
}

/**
 * A category as a client component sees it — plain data, passed down as props.
 *
 * A deliberate subset: the handoff address, the Drive folder id and the share
 * list never reach the browser. A lead's queue card has no use for them, and an
 * outside collaborator's address is not something to ship into a page.
 */
export interface LeadCategoryView {
  key: string
  label: string
  destination: LeadDestination
  /** One line under the lead's title saying where this is headed. */
  destination_note: string | null
  /** Whether a handoff address is configured — not the address itself. */
  handoff_ready: boolean
  tone: string
  active: boolean
}

/**
 * The badge palette, keyed by tone NAME.
 *
 * ⚠ These class strings must be literal in this file. Tailwind v4 emits only
 * the classes it finds by scanning source, so a class string stored in the
 * database and interpolated at runtime would produce an unstyled chip with no
 * error anywhere. The database stores the tone's NAME; this maps it.
 *
 * Adding a line of business therefore picks a tone from this list rather than
 * inventing one — which is also why the settings screen offers them as a
 * dropdown instead of a text field.
 */
export const TONE_BADGE: Record<string, string> = {
  blue: chipTone('info'),
  violet:
    chipTone('violet'),
  cyan: chipTone('cyan'),
  teal: chipTone('teal'),
  amber:
    chipTone('caution'),
  rose: chipTone('rose'),
  emerald:
    chipTone('positive'),
  indigo:
    chipTone('indigo'),
  sky: chipTone('sky'),
  slate:
    chipTone('neutral'),
}

/** Tone names offered in the settings screen, in the order they are shown. */
export const TONE_NAMES = Object.keys(TONE_BADGE)

/**
 * Read a lead's category vocabulary without every caller writing the same
 * `?? fallback` chain.
 *
 * Built over a list the server already loaded, so it is a Map lookup rather
 * than a round trip. Every accessor degrades: a lead whose category was renamed
 * out from under it still renders a humanised key and a slate chip rather than
 * a blank cell (§12 — never print a stored key at a reader).
 */
export type CategoryLookup = ReturnType<typeof categoryLookup>

export function categoryLookup(categories: LeadCategoryView[]) {
  const map = new Map(categories.map((c) => [c.key, c]))
  return {
    all: categories,
    get: (key: string): LeadCategoryView | null => map.get(key) ?? null,
    label: (key: string): string => map.get(key)?.label ?? enumLabel(key),
    tone: (key: string): string => TONE_BADGE[map.get(key)?.tone ?? 'slate'] ?? TONE_BADGE.slate,
    note: (key: string): string | null => map.get(key)?.destination_note ?? null,
    destination: (key: string): LeadDestination => map.get(key)?.destination ?? 'manual',
  }
}

/**
 * Where a lead came in from. Worth showing: a web-form deal arrives with a
 * checklist and a Drive folder behind it, an email lead with a thread, a
 * meeting lead with neither — only what somebody said on a call. They are read
 * and acted on differently, and a meeting lead in particular has no sender to
 * chase and no attachment to price.
 */
export const SOURCE_LABELS: Record<LeadSource, string> = {
  email: 'Email',
  web_form: 'Deal form',
  meeting: 'Meeting',
}

export const SOURCE_BADGE: Record<LeadSource, string> = {
  email:
    chipTone('neutral'),
  web_form:
    chipTone('sky'),
  meeting:
    chipTone('violet'),
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  promoted: 'Promoted',
  forwarded: 'Forwarded',
  ignored: 'Ignored',
  expired: 'Expired',
  spam: 'Filtered',
}

export const STATUS_BADGE: Record<LeadStatus, string> = {
  new: 'bg-primary/10 text-primary ring-primary/20',
  reviewing:
    chipTone('indigo'),
  promoted:
    chipTone('positive'),
  forwarded:
    chipTone('teal'),
  ignored:
    chipTone('neutral'),
  expired:
    chipTone('neutral'),
  spam:
    chipTone('neutral'),
}

export const FIT_BADGE: Record<FitRecommendation, string> = {
  pursue:
    chipTone('positive'),
  consider:
    chipTone('caution'),
  pass: chipTone('neutral'),
}

export const FIT_LABELS: Record<FitRecommendation, string> = {
  pursue: 'Pursue',
  consider: 'Consider',
  pass: 'Pass',
}

/**
 * Which one-click destination a lead offers, derived from its category.
 *
 * ⚠ Across 1,268 leads scored, ZERO were ever promoted or forwarded. Part of
 * that was surfacing, but part was this: the detail sheet offered four
 * destination buttons and nothing anywhere recommended one, so every promotion
 * asked a question the pipeline had in fact already answered. The category IS
 * that answer — it is what the triage prompt is FOR.
 *
 * `manual` deliberately maps to null. A lead the triage could not place is
 * exactly the one a human should place, and a one-click Accept that guessed
 * between five record types would file deals into the wrong module silently.
 * Null means "open the sheet", not "do nothing".
 */
export type LeadPromoteTarget = 'project' | 'opportunity' | 'steel' | 'handoff'

export function promoteTargetFor(
  destination: LeadDestination | null | undefined
): LeadPromoteTarget | null {
  switch (destination) {
    case 'project':
      return 'project'
    case 'steel_deal':
      return 'steel'
    case 'opportunity':
      return 'opportunity'
    // A handoff lane's audience has no platform login, so its leads leave by
    // email rather than becoming a record here.
    case 'handoff':
      return 'handoff'
    default:
      return null
  }
}

/**
 * Deep link to the lead's conversation in Gmail.
 *
 * `authuser=<address>` rather than a `/u/0/` index: the reader may well be
 * signed into several Google accounts, and the index is per-browser-session, so
 * a positional link opens the wrong mailbox as often as the right one.
 *
 * Links to the THREAD rather than the draft — a draft reply lives inside the
 * conversation, so this shows both, and it still works for a lead that has no
 * draft.
 */
export function gmailThreadUrl(mailbox: string | null, threadId: string | null): string | null {
  if (!threadId) return null
  const account = mailbox ? `?authuser=${encodeURIComponent(mailbox)}` : ''
  return `https://mail.google.com/mail/u/${account}#all/${threadId}`
}

/**
 * WHAT "STILL NEEDS WORKING" MEANS FOR A LEAD — the one home for the predicate.
 *
 * ⚠ THIS EXISTS BECAUSE THE QUANTITY MOVED HOUSE. Until 2026-10-22 inbound
 * leads were rendered on /decide, and this predicate was spelled out there in
 * two places (the page's row loop and `countDecideItems`). Leads now live only
 * on /leads (Richard, 10-22: *"all scrapings from info@berwilson to land and be
 * worked from within the leads section"*), which means a sidebar badge has to
 * carry the urgency /decide's deadline ranking used to carry — and a badge and
 * the page it points at reporting different numbers for one quantity is the
 * §12 bug this file has been bitten by before.
 *
 * So: ONE predicate, three readers — the badge (`countLeadsNeedingWork`), the
 * /leads header line, and nothing else. A fourth reader selects from here too.
 *
 * ⚠ `fit_recommendation` MAY BE NULL AND A NULL STILL NEEDS WORKING. An
 * untriaged bid invitation is the single thing most needing a human, and
 * `.neq('pass')` in SQL drops it — PostgREST treats NULL as not matching (§12).
 * The row test below must agree with that SQL exactly, which is why both are
 * written here together.
 */
export const LEAD_NEEDS_WORK_STATUSES = ['new', 'reviewing'] as const

/** The SQL half: `fit_recommendation is null OR <> 'pass'`, for `.or()`. */
export const LEAD_NEEDS_WORK_FIT_FILTER = 'fit_recommendation.is.null,fit_recommendation.neq.pass'

/**
 * The row half. Pure, so the browser can apply it to rows it already holds
 * rather than asking the server for a number it can derive.
 */
export function leadNeedsWork(lead: {
  status: string | null
  fit_recommendation: string | null
}): boolean {
  if (!lead.status) return false
  if (!(LEAD_NEEDS_WORK_STATUSES as readonly string[]).includes(lead.status)) return false
  return lead.fit_recommendation !== 'pass'
}

/**
 * A lead whose bid date is inside `days` and has not passed.
 *
 * ⚠ THE WHOLE REASON THE BADGE NEEDED BUILDING. A bid date was the only hard
 * deadline in the /decide queue — `decideWeight` ranked on it and the page
 * printed "N closing within a week" — so moving leads out without carrying the
 * deadline somewhere would have traded a cluttered screen for a missed bid.
 * Measured 10-22: of the 9 leads then needing work, two closed THAT DAY.
 *
 * Takes `now` rather than reading the clock, because a server component that
 * calls `Date.now()` is the react-hooks/purity misfire §9 records.
 */
export function leadClosingSoon(
  lead: { bid_due_date: string | null },
  now: number,
  days = 7
): boolean {
  if (!lead.bid_due_date) return false
  const due = Date.parse(`${lead.bid_due_date}T00:00:00Z`)
  if (!Number.isFinite(due)) return false
  const daysLeft = Math.ceil((due - now) / 86_400_000)
  return daysLeft >= 0 && daysLeft <= days
}
