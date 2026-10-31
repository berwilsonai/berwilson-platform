import type { DealStage } from '@/lib/supabase/types'
import {
  STAGE_PIPELINE, STAGE_CLOSED,
  STAGE_LABELS, STAGE_INDEX, STAGE_COLOR, STAGE_TEXT, STAGE_BADGE,
} from '@/lib/utils/stages'
import { cn } from '@/lib/utils'

interface StageIndicatorProps {
  stage: DealStage
  /** compact=true renders the pill-bar used inside ProjectCard */
  compact?: boolean
}

/**
 * Where a deal is, as a progress bar.
 *
 * ⚠ THE BAR RUNS OVER THE OPEN PIPELINE, NOT OVER EVERY STAGE — and that is a
 * correctness fix, not a layout preference. It mapped `STAGES` and filled every
 * segment up to `STAGE_INDEX[stage]`, so once Won and Lost joined the
 * vocabulary at indexes 4 and 5 a LOST deal rendered a completely full bar in
 * the colour of every stage it passed through. The reader's eye reads a full
 * bar as "finished well"; the deal was dead. Same arithmetic, opposite meaning.
 *
 * So a decided deal does not get a bar at all. It gets its outcome, said once,
 * in a chip — which is also the honest shape: Won and Lost are not a position
 * somewhere along a line, they are the end of it.
 */
export default function StageIndicator({
  stage,
  compact = false,
}: StageIndicatorProps) {
  const decided = (STAGE_CLOSED as DealStage[]).includes(stage)

  if (decided) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
          STAGE_BADGE[stage]
        )}
      >
        {STAGE_LABELS[stage]}
      </span>
    )
  }

  const currentIndex = STAGE_INDEX[stage]

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-0.5">
          {STAGE_PIPELINE.map((s, i) => (
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
        {STAGE_PIPELINE.map((s, i) => (
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
        {STAGE_PIPELINE.map((s, i) => (
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
