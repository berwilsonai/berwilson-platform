import Link from 'next/link'
import { Target, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  OBJECTIVE_HEALTH_LABELS,
  OBJECTIVE_HEALTH_BADGE,
  objectiveHealth,
} from '@/lib/utils/objectives'

export interface NowObjectiveItem {
  id: string
  title: string
  target_date: string | null
  health: string
  owner: { name: string; color: string | null } | null
  openTasks: number
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatTarget(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * The steering board's Now column, surfaced at the top of the Dashboard so the
 * morning read starts with "what we said matters" before "what's on fire".
 */
export default function NowObjectives({ items }: { items: NowObjectiveItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 label-caps text-muted-foreground">
          <Target size={13} /> Objectives — Now
        </div>
        <Link
          href="/objectives"
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Steering board <ArrowUpRight size={12} />
        </Link>
      </div>
      <ol className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((o, i) => (
          <li key={o.id} className="flex items-start gap-2.5 min-w-0">
            <span className="shrink-0 mt-0.5 inline-flex items-center justify-center size-5 rounded-full bg-muted text-[11px] font-semibold tnum text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {o.title}
                {objectiveHealth(o.health) !== 'on_track' && (
                  <span
                    className={cn(
                      'ml-1.5 inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset align-middle',
                      OBJECTIVE_HEALTH_BADGE[objectiveHealth(o.health)],
                    )}
                  >
                    {OBJECTIVE_HEALTH_LABELS[objectiveHealth(o.health)]}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {o.owner && <span>{initials(o.owner.name)}</span>}
                {o.target_date && <span className="tnum">by {formatTarget(o.target_date)}</span>}
                {o.openTasks > 0 && (
                  <span className="tnum">
                    {o.openTasks} open task{o.openTasks !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
