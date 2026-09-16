/**
 * Quote status vocabulary. Plain text with app-side constants, following the
 * convention used by steel stages, opportunities and leads — a check constraint
 * would mean a migration every time the lifecycle gains a state.
 */

export type QuoteStatus =
  | 'generating'
  | 'draft'
  | 'issued'
  | 'accepted'
  | 'declined'
  | 'superseded'

export const QUOTE_STATUSES: QuoteStatus[] = [
  'generating',
  'draft',
  'issued',
  'accepted',
  'declined',
  'superseded',
]

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  generating: 'Generating…',
  draft: 'Draft',
  issued: 'Issued',
  accepted: 'Accepted',
  declined: 'Declined',
  superseded: 'Superseded',
}

export const QUOTE_STATUS_BADGE: Record<QuoteStatus, string> = {
  generating: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  draft: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  issued: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  accepted: 'bg-emerald-600 text-white dark:bg-emerald-700',
  declined: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  superseded: 'bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400',
}

export function quoteStatus(value: string | null | undefined): QuoteStatus {
  return QUOTE_STATUSES.includes(value as QuoteStatus) ? (value as QuoteStatus) : 'draft'
}

/**
 * A draft has never left the building, so regenerating replaces it in place
 * rather than burning a revision number. Anything further along is a document
 * somebody may already be holding.
 */
export function isReplaceableDraft(status: string | null | undefined): boolean {
  return quoteStatus(status) === 'draft'
}

/** Issued or beyond — the quote exists outside the platform. */
export function isCommitted(status: string | null | undefined): boolean {
  const s = quoteStatus(status)
  return s === 'issued' || s === 'accepted' || s === 'declined'
}

/**
 * How long a 'generating' row may sit before it is treated as a crashed run
 * rather than a live one. Generation takes seconds; ten minutes is a crash.
 * Without this, one failure would latch the deal and no quote could ever be
 * generated for it again.
 */
export const GENERATING_STALE_MS = 10 * 60 * 1000

export function quoteLabel(quoteNumber: string, revision: number): string {
  return revision > 1 ? `${quoteNumber} rev ${revision}` : quoteNumber
}

/** Filename for the exported PDF, e.g. "Q-2026-1042 r2 Mira Vista Quote.pdf". */
export function quoteFileName(
  quoteNumber: string,
  revision: number,
  dealName: string,
  belowFloor: boolean
): string {
  const rev = revision > 1 ? ` r${revision}` : ''
  // DRAFT is in the FILENAME as well as the page footer, so a sub-floor quote
  // is recognisable in a Drive listing and in an email attachment without
  // anybody opening it.
  const draft = belowFloor ? 'DRAFT ' : ''
  const safeName = dealName.replace(/[^\w\s.-]/g, '').trim() || 'Quote'
  return `${draft}${quoteNumber}${rev} ${safeName} Prefab Steel Quote.pdf`
}
