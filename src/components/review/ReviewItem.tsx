import Link from 'next/link'
import { FileText, AlertCircle } from 'lucide-react'
import type { ReviewQueueItem } from '@/types/domain'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import ReviewActions from './ReviewActions'

const REASON_LABELS: Record<string, string> = {
  low_confidence: 'Low Confidence',
  ambiguous_project: 'Ambiguous Project',
  unknown_party: 'Unknown Party',
  conflicting_data: 'Conflicting Data',
}

const SOURCE_TABLE_LABELS: Record<string, string> = {
  updates: 'Update',
  documents: 'Document',
  parties: 'Contact',
}

function buildSourceLink(item: ReviewQueueItem): string {
  if (!item.project_id) return '/review'
  switch (item.source_table) {
    case 'updates':
      return `/projects/${item.project_id}/updates`
    case 'documents':
      return `/projects/${item.project_id}/documents`
    case 'parties':
      return `/contacts/${item.record_id}`
    default:
      return `/projects/${item.project_id}`
  }
}

interface ReviewItemProps {
  item: ReviewQueueItem
}

export default function ReviewItem({ item }: ReviewItemProps) {
  const sourceLink = buildSourceLink(item)
  const sourceLabel = SOURCE_TABLE_LABELS[item.source_table] ?? item.source_table
  const reasonLabel = REASON_LABELS[item.reason] ?? item.reason

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
            <FileText size={11} />
            {sourceLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 ring-1 ring-amber-200 ring-inset px-2 py-0.5 rounded">
            <AlertCircle size={11} />
            {reasonLabel}
          </span>
          {item.confidence !== null && (
            <ConfidenceBadge confidence={item.confidence} />
          )}
        </div>
        {item.project && (
          <Link
            href={`/projects/${item.project.id}`}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline shrink-0"
          >
            {item.project.name}
          </Link>
        )}
      </div>

      {/* AI explanation */}
      {item.ai_explanation && (
        <p className="text-sm text-foreground leading-relaxed">{item.ai_explanation}</p>
      )}

      {/* Source record link */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <Link
          href={sourceLink}
          className="text-xs text-primary hover:underline"
        >
          View source record →
        </Link>
        <ReviewActions reviewId={item.id} sourceLink={sourceLink} />
      </div>
    </div>
  )
}
