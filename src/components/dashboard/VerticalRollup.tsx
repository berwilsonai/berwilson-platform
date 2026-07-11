import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SECTORS,
  SECTOR_LABELS,
  SECTOR_BADGE,
  formatValue,
  weightedValue,
} from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'

export interface RollupProject {
  sector: string | null
  estimated_value: number | null
  win_probability?: number | null
}

/**
 * Per-vertical rollup: how each sector of the vertically integrated platform
 * is doing, at a glance — count, pipeline value, weighted value. Sectors are
 * the vertical dimension (government / infrastructure / real estate / prefab /
 * institutional / technology / health).
 */
export default function VerticalRollup({ projects }: { projects: RollupProject[] }) {
  const rows = SECTORS.map((sector) => {
    const list = projects.filter((p) => p.sector === sector)
    return {
      sector,
      count: list.length,
      pipeline: list.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0),
      weighted: list.reduce(
        (sum, p) => sum + weightedValue(p.estimated_value, p.win_probability ?? null),
        0
      ),
    }
  })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.pipeline - a.pipeline)

  // With everything in one vertical the KPI band already tells the story.
  if (rows.length < 2) return null

  return (
    <div className="rounded-xl border border-border bg-card p-4 elev-1">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        <Layers size={13} /> By Vertical
        <span className="tabular-nums font-normal">{rows.length}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-4">
        {rows.map((r) => (
          <div key={r.sector} className="min-w-0">
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                SECTOR_BADGE[r.sector as ProjectSector]
              )}
            >
              {SECTOR_LABELS[r.sector as ProjectSector]}
            </span>
            <p className="text-lg font-semibold tnum mt-1.5">
              {r.pipeline > 0 ? formatValue(r.pipeline) : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground tnum">
              {r.count} project{r.count !== 1 ? 's' : ''}
              {r.weighted > 0 && ` · ${formatValue(r.weighted)} wtd`}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
