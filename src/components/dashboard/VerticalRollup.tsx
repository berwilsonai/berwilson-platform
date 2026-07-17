import { Layers } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import {
  SECTORS,
  SECTOR_SHORT,
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
 * is doing, at a glance — count, pipeline value, weighted value. Rendered as a
 * compact list in the dashboard's right rail.
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
    <div className="rounded-xl border border-border bg-card elev-1">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Layers size={13} className="text-muted-foreground" />
        <h2 className="label-caps text-muted-foreground">By Vertical</h2>
        <span className="ml-auto text-xs text-muted-foreground tnum">{rows.length}</span>
      </div>
      <div className="p-3 space-y-1">
        {rows.map((r) => (
          <div key={r.sector} className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Chip tone={SECTOR_BADGE[r.sector as ProjectSector]}>
              {SECTOR_SHORT[r.sector as ProjectSector]}
            </Chip>
            <span className="text-xs text-muted-foreground tnum">
              {r.count} project{r.count !== 1 ? 's' : ''}
            </span>
            <span className="ml-auto text-sm font-semibold tnum">
              {r.pipeline > 0 ? formatValue(r.pipeline) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
