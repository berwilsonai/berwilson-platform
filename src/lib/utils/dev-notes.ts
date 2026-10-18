import { chipTone } from '@/lib/ui/tone'

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
  bug: chipTone('critical'),
  feature: chipTone('violet'),
  improvement: chipTone('sky'),
  question: chipTone('neutral'),
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
  open: chipTone('caution'),
  in_progress: chipTone('info'),
  done: chipTone('positive'),
  wont_do: chipTone('neutral'),
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
  high: chipTone('critical'),
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
