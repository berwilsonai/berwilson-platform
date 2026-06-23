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
      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800/60'
      : confidence >= 0.6
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800/60'
        : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 ring-red-200 dark:ring-red-800/60'

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
