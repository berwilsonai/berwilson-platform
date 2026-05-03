import Link from 'next/link'
import { FileText, AlertCircle, CheckCircle2, XCircle, Pencil } from 'lucide-react'
import type { ReviewQueueItem, MentionedParty } from '@/types/domain'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import ReviewActions from './ReviewActions'
import MentionedPartiesPanel from './MentionedPartiesPanel'

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

const RESOLUTION_CONFIG: Record<string, { label: string; color: string; Icon: React.ComponentType<{ size?: number }> }> = {
  approved: { label: 'Approved', color: 'text-emerald-700 bg-emerald-50 ring-emerald-200', Icon: CheckCircle2 },
  edited: { label: 'Approved (edited)', color: 'text-emerald-700 bg-emerald-50 ring-emerald-200', Icon: Pencil },
  rejected: { label: 'Rejected', color: 'text-rose-700 bg-rose-50 ring-rose-200', Icon: XCircle },
}

interface ReviewItemProps {
  item: ReviewQueueItem
  allProjects: { id: string; name: string }[]
  mentionedParties?: MentionedParty[]
  showResolved?: boolean
}

export default function ReviewItem({ item, allProjects, mentionedParties = [], showResolved = false }: ReviewItemProps) {
  const isResolved = !!item.resolved_at
  const sourceLink = buildSourceLink(item)
  const sourceLabel = SOURCE_TABLE_LABELS[item.source_table] ?? item.source_table
  const reasonLabel = REASON_LABELS[item.reason] ?? item.reason

  const resolutionCfg = item.resolution ? RESOLUTION_CONFIG[item.resolution] : null

  return (
    <div className={`bg-card border border-border rounded-lg p-4 space-y-3 ${isResolved ? 'opacity-60' : ''}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
            <FileText size={11} />
            {sourceLabel}
          </span>
          {!isResolved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 ring-1 ring-amber-200 ring-inset px-2 py-0.5 rounded">
              <AlertCircle size={11} />
              {reasonLabel}
            </span>
          )}
          {resolutionCfg && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium ring-1 ring-inset px-2 py-0.5 rounded ${resolutionCfg.color}`}>
              <resolutionCfg.Icon size={11} />
              {resolutionCfg.label}
            </span>
          )}
          {item.confidence !== null && !isResolved && (
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

      {/* Mentioned parties from AI extraction */}
      <MentionedPartiesPanel parties={mentionedParties} />

      {/* Source record link + actions */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <Link
          href={sourceLink}
          className="text-xs text-primary hover:underline"
        >
          View source record →
        </Link>
        {!isResolved && (
          <ReviewActions
            reviewId={item.id}
            recordId={item.record_id}
            sourceTable={item.source_table}
            sourceLink={sourceLink}
            currentProjectId={item.project_id ?? undefined}
            allProjects={allProjects}
            reason={item.reason}
          />
        )}
      </div>
    </div>
  )
}
