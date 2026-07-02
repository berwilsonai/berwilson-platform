/**
 * Constants for the Email Ingestion module. Session status is plain text + these
 * app-level labels/badges (see the email_intake_sessions migration).
 */

export type EmailIntakeStatus = 'pending' | 'confirmed' | 'dismissed'

export const EMAIL_INTAKE_STATUS_LABELS: Record<EmailIntakeStatus, string> = {
  pending: 'Needs review',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
}

export const EMAIL_INTAKE_STATUS_BADGE: Record<EmailIntakeStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  dismissed: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export function emailIntakeStatus(value: string | null | undefined): EmailIntakeStatus {
  return value === 'confirmed' || value === 'dismissed' ? value : 'pending'
}
