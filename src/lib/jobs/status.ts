/**
 * The job state machine, in ONE place.
 *
 * ⚠ EVERY KIND-KEYED STRUCTURE IS DERIVED FROM THIS, because a hand-written
 * enumeration beside a registry drifts and a ⚠ comment saying so does not stop
 * the sibling drifting (§12 — /decide fixed exactly this in its count map and
 * left the chip row spelled out, so a new kind got a count and no chip). The
 * declaration order below IS the reading order.
 *
 * Pure: no `next/*`, no client imports, so a server page, a client component
 * and a verification script can all read it.
 */

import type { Tone } from '@/lib/ui/tone'

export const JOB_STATUSES = [
  'queued', 'working', 'review', 'applying', 'done', 'failed', 'cancelled',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface JobStatusSpec {
  label: string
  tone: Tone
  /** What the reader should understand is happening, in a phrase. */
  hint: string
  /** The row is still moving — a reader should expect it to change. */
  live: boolean
}

export const JOB_STATUS: Record<JobStatus, JobStatusSpec> = {
  queued:   { label: 'Queued',    tone: 'neutral',  hint: 'waiting for the model to be free', live: true },
  working:  { label: 'Working',   tone: 'info',     hint: 'reading the records', live: true },
  review:   { label: 'Needs you', tone: 'caution',  hint: 'it proposed changes — tick the ones to make', live: false },
  applying: { label: 'Applying',  tone: 'info',     hint: 'making the changes you ticked', live: true },
  done:     { label: 'Done',      tone: 'positive', hint: 'finished', live: false },
  failed:   { label: 'Failed',    tone: 'critical', hint: 'it stopped on an error', live: false },
  cancelled:{ label: 'Cancelled', tone: 'neutral',  hint: 'stopped before it finished', live: false },
}

export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === 'string' && (JOB_STATUSES as readonly string[]).includes(v)
}

/** Never print a raw stored value at a reader (§7). */
export function jobStatusSpec(v: unknown): JobStatusSpec {
  return isJobStatus(v) ? JOB_STATUS[v] : { label: String(v ?? 'Unknown'), tone: 'neutral', hint: '', live: false }
}

/**
 * A `working` job whose heartbeat has gone quiet was killed — by a deploy,
 * most likely, since `npm run build` IS the deploy. The runner reclaims it, but
 * a reader looking at the row now needs to be told it is not actually moving:
 * a count that has stopped growing is indistinguishable from a quiet inbox
 * unless something reads the CLOCK (§12).
 */
export function isStalled(
  status: unknown,
  heartbeatAt: string | null,
  staleMs: number,
  now = Date.now()
): boolean {
  if (status !== 'working') return false
  if (!heartbeatAt) return true
  return now - new Date(heartbeatAt).getTime() > staleMs
}
