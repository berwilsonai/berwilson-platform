import type { ProjectStage } from '@/lib/supabase/types'
import { STAGES, STAGE_LABELS, STAGE_INDEX } from '@/lib/utils/stages'
import { cn } from '@/lib/utils'

interface StageIndicatorProps {
  stage: ProjectStage
  /** compact=true renders the pill-bar used inside ProjectCard */
  compact?: boolean
}

export default function StageIndicator({
  stage,
  compact = false,
}: StageIndicatorProps) {
  const currentIndex = STAGE_INDEX[stage]

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          {STAGES.map((s, i) => (
            <div
              key={s}
              title={STAGE_LABELS[s]}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i < currentIndex
                  ? 'w-3 bg-emerald-500'
                  : i === currentIndex
                    ? 'w-4 bg-blue-500'
                    : 'w-3 bg-slate-200'
              )}
            />
          ))}
        </div>
        <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
          {STAGE_LABELS[stage]}
        </span>
      </div>
    )
  }

  // Full-width labeled version
  return (
    <div className="space-y-1.5">
      <div className="flex gap-0.5">
        {STAGES.map((s, i) => (
          <div
            key={s}
            className={cn(
              'h-2 flex-1 rounded-sm',
              i < currentIndex
                ? 'bg-emerald-500'
                : i === currentIndex
                  ? 'bg-blue-500'
                  : 'bg-slate-200'
            )}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className={cn(
              'text-[10px] font-medium',
              i === currentIndex
                ? 'text-blue-600'
                : i < currentIndex
                  ? 'text-emerald-600'
                  : 'text-muted-foreground/60'
            )}
          >
            {STAGE_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
