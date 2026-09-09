/**
 * Vocabulary for the review queue.
 *
 * One definition, because there were already two divergent copies (ReviewItem
 * and ReviewFilters) and /decide was about to need a third — at which point a
 * reason added in one place renders as a raw slug in the others.
 */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  low_confidence: 'Low Confidence',
  ambiguous_project: 'Ambiguous Project',
  unknown_party: 'Unknown Party',
  conflicting_data: 'Conflicting Data',
  new_contact: 'New Contact',
  unknown_project: 'Unknown Project',
  /** An email thread matched to a record by name or contacts rather than by fact. */
  inferred_email_match: 'Email — Unconfirmed Match',
}

/** The reasons offered as filters. */
export const REVIEW_REASONS = Object.keys(REVIEW_REASON_LABELS)

export function reviewReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Needs review'
  return REVIEW_REASON_LABELS[reason] ?? reason
}
