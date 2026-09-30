/**
 * The lead routing registry.
 *
 * One row per line of business. This is the ONLY place a category is defined —
 * the queue tabs, the triage prompt, the destination buttons, the handoff
 * address, the Drive folder and the published sheet all read from here. Adding
 * flooring is an INSERT, not a deploy.
 *
 * Server-only: it holds the service-role client, so it must never be imported
 * from a `'use client'` file (§12 — every export of a client module becomes a
 * client reference, and calling one from a server page throws at request time
 * with nothing caught at build). Client components take categories as props;
 * the pure label/tone helpers they need live in `src/lib/utils/leads.ts`.
 */

import { leadsDb } from './db'

/**
 * What a lead of a category becomes when a human accepts it.
 *
 * `manual` is not "do nothing" — it is "the human places this one", which is the
 * correct answer for a lead the triage could not categorise. Offering a
 * one-click destination there would file deals into the wrong module silently.
 */
export type LeadDestination = 'project' | 'opportunity' | 'steel_deal' | 'handoff' | 'manual'

export const LEAD_DESTINATIONS: LeadDestination[] = [
  'project',
  'opportunity',
  'steel_deal',
  'handoff',
  'manual',
]

/**
 * The key every unrecognised route coerces to. Reserved: its row is flagged
 * `system`, so the settings screen will not offer to delete or rename it.
 */
export const FALLBACK_ROUTE = 'unknown'

export interface LeadCategory {
  id: string
  key: string
  label: string
  destination: LeadDestination
  /** Read to the triage model verbatim as this category's routing rule. */
  routing_rule: string | null
  /** One line shown under a lead's title saying where it is headed. */
  destination_note: string | null
  handoff_email: string | null
  /** Outside addresses granted reader on this category's folder and sheet. */
  share_with: string[]
  drive_folder_id: string | null
  publish_sheet: boolean
  owner_team_member_id: string | null
  chat_webhook_key: string | null
  /** Tone NAME, resolved to Tailwind classes in src/lib/utils/leads.ts. */
  tone: string
  sort_order: number
  active: boolean
  /** Code depends on this row by key; it cannot be deleted or renamed. */
  system: boolean
}

const COLUMNS =
  'id, key, label, destination, routing_rule, destination_note, handoff_email, share_with, ' +
  'drive_folder_id, publish_sheet, owner_team_member_id, chat_webhook_key, tone, sort_order, ' +
  'active, system'

/**
 * Process-lifetime cache.
 *
 * The categories are read on every triage call, every queue render and every
 * sheet publish, and they change roughly never — but a 60s TTL rather than a
 * permanent cache because `next start` loads the build at boot and holds it for
 * days (§12): a permanently cached taxonomy would mean an edit in settings did
 * not take effect until the next deploy. The settings writer also calls
 * `invalidateCategoryCache()` so its own change is visible immediately.
 */
let cache: { rows: LeadCategory[]; at: number } | null = null
const TTL_MS = 60_000

export function invalidateCategoryCache(): void {
  cache = null
}

function normalize(raw: Record<string, unknown>): LeadCategory {
  return {
    id: String(raw.id),
    key: String(raw.key),
    label: String(raw.label),
    destination: (raw.destination as LeadDestination) ?? 'manual',
    routing_rule: (raw.routing_rule as string | null) ?? null,
    destination_note: (raw.destination_note as string | null) ?? null,
    handoff_email: (raw.handoff_email as string | null) ?? null,
    share_with: Array.isArray(raw.share_with) ? (raw.share_with as string[]) : [],
    drive_folder_id: (raw.drive_folder_id as string | null) ?? null,
    publish_sheet: raw.publish_sheet === true,
    owner_team_member_id: (raw.owner_team_member_id as string | null) ?? null,
    chat_webhook_key: (raw.chat_webhook_key as string | null) ?? null,
    tone: typeof raw.tone === 'string' && raw.tone ? raw.tone : 'slate',
    sort_order: typeof raw.sort_order === 'number' ? raw.sort_order : 100,
    active: raw.active !== false,
    system: raw.system === true,
  }
}

/**
 * Every category, active and retired, in display order.
 *
 * Retired ones are included because they still label existing leads: the one
 * dino-routed lead in the queue must still render as "Dino (retired)" rather
 * than as a bare key. Filter to `active` when offering a CHOICE — a tab to
 * classify into, or a rule read to the model.
 */
export async function listCategories(): Promise<LeadCategory[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows

  const { data, error } = await leadsDb()
    .from('lead_categories')
    .select(COLUMNS)
    .order('sort_order', { ascending: true })

  // Checked rather than destructured past: a 42703 from a renamed column comes
  // back on `error` with `data` null, and silently returning an empty taxonomy
  // would route every lead to `unknown` while reporting nothing (§12, 09-30).
  if (error) throw new Error(`Could not load lead categories: ${error.message}`)

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(normalize)
  if (rows.length === 0) {
    throw new Error(
      'No lead categories are configured. The routing registry is seeded by ' +
        'migration 20260930000002_lead_categories.sql — apply it before sweeping leads.'
    )
  }

  cache = { rows, at: Date.now() }
  return rows
}

export async function listActiveCategories(): Promise<LeadCategory[]> {
  return (await listCategories()).filter((c) => c.active)
}

export async function categoriesByKey(): Promise<Map<string, LeadCategory>> {
  return new Map((await listCategories()).map((c) => [c.key, c]))
}

export async function getCategory(key: string): Promise<LeadCategory | null> {
  return (await categoriesByKey()).get(key) ?? null
}

/**
 * Coerce whatever the model (or a web form) said into a real category key.
 *
 * Only ACTIVE keys are accepted. A retired category must keep labelling the
 * leads it already owns, but must never receive a new one — that is what
 * retiring it means.
 */
export async function resolveRoute(value: unknown): Promise<string> {
  if (typeof value !== 'string') return FALLBACK_ROUTE
  const key = value.trim().toLowerCase()
  const match = (await listCategories()).find((c) => c.key === key)
  return match?.active ? match.key : FALLBACK_ROUTE
}

/** Zeroed per-category counter, for a sweep's progress report. */
export async function emptyRouteTally(): Promise<Record<string, number>> {
  const tally: Record<string, number> = {}
  for (const c of await listCategories()) tally[c.key] = 0
  return tally
}
