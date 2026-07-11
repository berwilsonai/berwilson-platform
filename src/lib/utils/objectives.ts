/**
 * Constants for the Objectives board — the Now / Soon / Possibly buckets and
 * how they render. Stored as text in the DB (no Postgres enums), so this file
 * is the source of truth for the allowed values.
 */

export type ObjectiveBucket = 'now' | 'soon' | 'possibly'

export const OBJECTIVE_BUCKETS: ObjectiveBucket[] = ['now', 'soon', 'possibly']

export const OBJECTIVE_BUCKET_LABELS: Record<ObjectiveBucket, string> = {
  now: 'Now',
  soon: 'Soon',
  possibly: 'Possibly',
}

/** Column accent — the header dot + count pill for each bucket. */
export const OBJECTIVE_BUCKET_ACCENT: Record<ObjectiveBucket, string> = {
  now: 'bg-red-500',
  soon: 'bg-amber-400',
  possibly: 'bg-slate-400',
}

export const OBJECTIVE_BUCKET_BADGE: Record<ObjectiveBucket, string> = {
  now: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  soon: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  possibly: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export function objectiveBucket(value: string | null | undefined): ObjectiveBucket {
  return OBJECTIVE_BUCKETS.includes(value as ObjectiveBucket)
    ? (value as ObjectiveBucket)
    : 'possibly'
}

// ─── Health ──────────────────────────────────────────────────────────────────
// An explicit "is this being met" judgment per objective. On-track stays
// visually silent (calm instrument); at-risk and stalled get flagged on the
// board, the dashboard strip, and the daily brief's Steering Check.

export type ObjectiveHealth = 'on_track' | 'at_risk' | 'stalled'

export const OBJECTIVE_HEALTHS: ObjectiveHealth[] = ['on_track', 'at_risk', 'stalled']

export const OBJECTIVE_HEALTH_LABELS: Record<ObjectiveHealth, string> = {
  on_track: 'On Track',
  at_risk: 'At Risk',
  stalled: 'Stalled',
}

export const OBJECTIVE_HEALTH_BADGE: Record<ObjectiveHealth, string> = {
  on_track: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  at_risk: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  stalled: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export function objectiveHealth(value: string | null | undefined): ObjectiveHealth {
  return OBJECTIVE_HEALTHS.includes(value as ObjectiveHealth)
    ? (value as ObjectiveHealth)
    : 'on_track'
}
