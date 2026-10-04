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
  blue: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  violet:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
  amber:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
  emerald:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  indigo:
    'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  slate:
    'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
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
    'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
  web_form:
    'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  meeting:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
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
    'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  promoted:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  forwarded:
    'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
  ignored:
    'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
  expired:
    'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20',
  spam:
    'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20',
}

export const FIT_BADGE: Record<FitRecommendation, string> = {
  pursue:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  consider:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  pass: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
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
