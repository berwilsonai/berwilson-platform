import type { ProjectStage } from '@/lib/supabase/types'
import { STAGES, STAGE_LABELS, STAGE_INDEX, STAGE_COLOR } from '@/lib/utils/stages'
import { cn } from '@/lib/utils'

/** Text color to match each stage's identity — used for labels */
const STAGE_TEXT: Record<ProjectStage, string> = {
  pursuit: 'text-muted-foreground',
  capture: 'text-violet-600 dark:text-violet-400',
  bid: 'text-caution',
  award: 'text-info',
  mobilization: 'text-cyan-600 dark:text-cyan-400',
  execution: 'text-positive',
  closeout: 'text-indigo-600 dark:text-indigo-400',
}

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
                i <= currentIndex
                  ? cn('w-3', STAGE_COLOR[s])
                  : 'w-3 bg-muted dark:bg-muted/60',
                i === currentIndex && 'w-4'
              )}
            />
          ))}
        </div>
        <span className={cn('text-xs font-medium tnum', STAGE_TEXT[stage])}>
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
              i <= currentIndex
                ? STAGE_COLOR[s]
                : 'bg-muted dark:bg-muted/60'
            )}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className={cn(
              'text-xs font-medium',
              i <= currentIndex
                ? STAGE_TEXT[s]
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
