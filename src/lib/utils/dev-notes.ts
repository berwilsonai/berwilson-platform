/**
 * Vocabulary for Developer Notes — the in-app bug / feature reporter.
 *
 * Kind, status and priority are stored as plain text (no Postgres enums), so
 * this file is the source of truth for the allowed values and the ONLY place
 * they are spelled. The API validates against these lists; the UI renders from
 * them.
 */

// ─── Kind ────────────────────────────────────────────────────────────────────

export type DevNoteKind = 'bug' | 'feature' | 'improvement' | 'question'

export const DEV_NOTE_KINDS: DevNoteKind[] = ['bug', 'feature', 'improvement', 'question']

export const DEV_NOTE_KIND_LABELS: Record<DevNoteKind, string> = {
  bug: 'Bug',
  feature: 'Feature request',
  improvement: 'Improvement',
  question: 'Question',
}

/** Short form for chips, where the full "Feature request" crowds the row. */
export const DEV_NOTE_KIND_SHORT: Record<DevNoteKind, string> = {
  bug: 'Bug',
  feature: 'Feature',
  improvement: 'Improve',
  question: 'Question',
}

export const DEV_NOTE_KIND_BADGE: Record<DevNoteKind, string> = {
  bug: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  feature: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  improvement: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  question: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export function devNoteKind(value: string | null | undefined): DevNoteKind {
  return DEV_NOTE_KINDS.includes(value as DevNoteKind) ? (value as DevNoteKind) : 'bug'
}

// ─── Status ──────────────────────────────────────────────────────────────────
// The task behaviour: `open` and `in_progress` are live work, `done` and
// `wont_do` are settled. A settled note is archived, never deleted — the record
// of what was reported and what came of it is the point.

export type DevNoteStatus = 'open' | 'in_progress' | 'done' | 'wont_do'

export const DEV_NOTE_STATUSES: DevNoteStatus[] = ['open', 'in_progress', 'done', 'wont_do']

export const DEV_NOTE_STATUS_LABELS: Record<DevNoteStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  wont_do: "Won't do",
}

export const DEV_NOTE_STATUS_BADGE: Record<DevNoteStatus, string> = {
  open: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  wont_do: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

/** Settled — checked off one way or the other. Drives the open/closed split. */
export function isDevNoteClosed(status: string | null | undefined): boolean {
  return status === 'done' || status === 'wont_do'
}

export function devNoteStatus(value: string | null | undefined): DevNoteStatus {
  return DEV_NOTE_STATUSES.includes(value as DevNoteStatus) ? (value as DevNoteStatus) : 'open'
}

// ─── Priority ────────────────────────────────────────────────────────────────

export type DevNotePriority = 'low' | 'normal' | 'high'

export const DEV_NOTE_PRIORITIES: DevNotePriority[] = ['low', 'normal', 'high']

export const DEV_NOTE_PRIORITY_LABELS: Record<DevNotePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}

/**
 * Only `high` is coloured. Normal is the default on every report, so badging it
 * would put a chip on nearly every row and teach the eye to skip the column
 * that the one urgent item needs.
 */
export const DEV_NOTE_PRIORITY_BADGE: Record<DevNotePriority, string> = {
  low: 'bg-muted text-muted-foreground ring-border',
  normal: 'bg-muted text-muted-foreground ring-border',
  high: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export function devNotePriority(value: string | null | undefined): DevNotePriority {
  return DEV_NOTE_PRIORITIES.includes(value as DevNotePriority)
    ? (value as DevNotePriority)
    : 'normal'
}

/** Sort weight — high first, then normal, then low. */
export const DEV_NOTE_PRIORITY_RANK: Record<DevNotePriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
}
