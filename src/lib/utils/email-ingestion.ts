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
  pending: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  dismissed: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  running: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  failed: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
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
