import Link from 'next/link'
import { UserRound, FolderKanban, ListChecks, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STAGE_LABELS, STAGE_BADGE, formatValue,
  bidDueLabel, bidDueColor,
} from '@/lib/utils/constants'
import type { ProjectStage } from '@/lib/supabase/types'

export interface CapacityPursuit {
  id: string
  name: string
  stage: ProjectStage
  estimatedValue: number | null
  weighted: number
  bidDue: string | null
}

export interface CapacityOwner {
  name: string
  isUnassigned: boolean
  pursuits: CapacityPursuit[]
  totalValue: number
  weightedValue: number
  openTasks: number
}

export default function CapacityBoard({ owners }: { owners: CapacityOwner[] }) {
  if (owners.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        No pursuits to allocate yet. Set a Capture Lead on your projects to see workload by owner.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {owners.map((owner) => (
        <div key={owner.name} className="rounded-lg border border-border bg-card shadow-sm overflow-hidden flex flex-col">
          {/* Owner header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
            <div
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-full shrink-0 ring-1 ring-inset',
                owner.isUnassigned ? 'bg-slate-100 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-800/60' : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 ring-blue-200 dark:ring-blue-800/60'
              )}
            >
              <UserRound size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-semibold truncate', owner.isUnassigned && 'text-muted-foreground')}>
                {owner.name}
              </p>
              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FolderKanban size={10} /> {owner.pursuits.length} pursuit{owner.pursuits.length !== 1 ? 's' : ''}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ListChecks size={10} /> {owner.openTasks} task{owner.openTasks !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
            <div className="px-4 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pipeline</p>
              <p className="text-sm font-bold tabular-nums">{formatValue(owner.totalValue)}</p>
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Weighted</p>
              <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatValue(owner.weightedValue)}</p>
            </div>
          </div>

          {/* Pursuit list */}
          <div className="divide-y divide-border flex-1">
            {owner.pursuits.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group flex items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors"
              >
                <span className={cn('inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium ring-1 ring-inset shrink-0', STAGE_BADGE[p.stage])}>
                  {STAGE_LABELS[p.stage]}
                </span>
                <span className="text-xs text-foreground truncate flex-1 group-hover:text-primary transition-colors">
                  {p.name}
                </span>
                {p.bidDue && (
                  <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium shrink-0', bidDueColor(p.bidDue))}>
                    <Timer size={9} />
                    {bidDueLabel(p.bidDue)}
                  </span>
                )}
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground shrink-0">
                  {formatValue(p.estimatedValue)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
