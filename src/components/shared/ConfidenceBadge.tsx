import { cn } from '@/lib/utils'

interface ConfidenceBadgeProps {
  confidence: number | null
  className?: string
}

export default function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  if (confidence === null || confidence === undefined) return null

  const pct = Math.round(confidence * 100)
  const color =
    confidence >= 0.8
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : confidence >= 0.6
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-red-50 text-red-600 ring-red-200'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        color,
        className
      )}
      title={`AI confidence: ${pct}%`}
    >
      {pct}%
    </span>
  )
}
