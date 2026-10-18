import { chipTone } from '@/lib/ui/tone'

/**
 * Constants for the Email Ingestion module. Session status is plain text + these
 * app-level labels/badges (see the email_intake_sessions migration).
 *
 * Lifecycle: an in-platform research run stages a `running` row immediately
 * (so it shows under Recent even if the user navigates away), then flips it to
 * `pending` on success or `failed` on error. Manual paste skips `running`.
 */

export type EmailIntakeStatus = 'pending' | 'confirmed' | 'dismissed' | 'running' | 'failed'

export const EMAIL_INTAKE_STATUS_LABELS: Record<EmailIntakeStatus, string> = {
  pending: 'Needs review',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
  running: 'Researching…',
  failed: 'Failed',
}

export const EMAIL_INTAKE_STATUS_BADGE: Record<EmailIntakeStatus, string> = {
  pending: chipTone('caution'),
  confirmed: chipTone('positive'),
  dismissed: chipTone('neutral'),
  running: chipTone('sky'),
  failed: chipTone('critical'),
}

export function emailIntakeStatus(value: string | null | undefined): EmailIntakeStatus {
  return value === 'confirmed' || value === 'dismissed' || value === 'running' || value === 'failed'
    ? value
    : 'pending'
}

/**
 * A run's server function caps at 5 minutes — a row still `running` well past
 * that means the function died without reaching its failure handler.
 */
export const EMAIL_INTAKE_RUN_TIMEOUT_MS = 15 * 60 * 1000

/** Status with stale-`running` rows treated as failed. */
export function effectiveEmailIntakeStatus(
  status: string | null | undefined,
  updatedAt: string | null | undefined
): EmailIntakeStatus {
  const st = emailIntakeStatus(status)
  if (st === 'running' && updatedAt && Date.now() - new Date(updatedAt).getTime() > EMAIL_INTAKE_RUN_TIMEOUT_MS) {
    return 'failed'
  }
  return st
}
