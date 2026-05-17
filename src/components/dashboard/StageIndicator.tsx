import type { ProjectStage } from '@/lib/supabase/types'
import { STAGES, STAGE_LABELS, STAGE_INDEX, STAGE_COLOR, STAGE_BADGE } from '@/lib/utils/stages'
import { cn } from '@/lib/utils'

/** Text color to match each stage's identity — used for labels */
const STAGE_TEXT: Record<ProjectStage, string> = {
  pursuit: 'text-slate-500',
  capture: 'text-violet-600',
  bid: 'text-amber-600',
  award: 'text-blue-600',
  mobilization: 'text-cyan-600',
  execution: 'text-emerald-600',
  closeout: 'text-indigo-600',
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
                  : 'w-3 bg-slate-200',
                i === currentIndex && 'w-4'
              )}
            />
          ))}
        </div>
        <span className={cn('text-xs font-medium tabular-nums', STAGE_TEXT[stage])}>
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
