import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface ConfidenceBadgeProps {
  confidence: number | null
  className?: string
}

function confidenceDescription(confidence: number): string {
  if (confidence >= 0.8) return 'High confidence — AI extraction is likely accurate'
  if (confidence >= 0.6) return 'Medium confidence — review recommended'
  return 'Low confidence — manual review required'
}

export default function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  if (confidence === null || confidence === undefined) return null

  const pct = Math.round(confidence * 100)
  const color =
    confidence >= 0.8
      ? 'bg-positive-surface text-positive ring-positive-edge'
      : confidence >= 0.6
        ? 'bg-caution-surface text-caution ring-caution-edge'
        : 'bg-critical-surface text-critical ring-critical-edge'

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset cursor-help',
          color,
          className
        )}
      >
        {pct}%
      </TooltipTrigger>
      <TooltipContent>
        AI Confidence: {pct}% — {confidenceDescription(confidence)}
      </TooltipContent>
    </Tooltip>
  )
}
