import { Panel } from '@/components/ui/card'

/**
 * Mirrors the board: title row, the workload chips that double as assignee
 * filters, the filter row, then task rows.
 *
 * /tasks had no `loading.tsx` either, so one of the five mobile tab-bar routes
 * showed the previous page frozen while eight queries ran.
 */
export default function TasksLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="h-6 w-36 rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-[2.75rem] sm:h-8 w-28 rounded-md bg-muted" />
          <div className="h-[2.75rem] sm:h-8 w-24 rounded-md bg-muted" />
        </div>
      </div>

      {/* Workload chips */}
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 w-40 shrink-0 rounded-lg border border-border bg-card" />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[2.75rem] sm:h-8 w-[10.5rem] rounded-md bg-muted" />
        ))}
      </div>

      <Panel className="divide-y divide-border">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="size-5 rounded-full bg-muted shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="flex gap-2">
                <div className="h-3 w-24 rounded bg-muted/70" />
                <div className="h-3 w-20 rounded bg-muted/70" />
              </div>
            </div>
            <div className="h-5 w-16 rounded bg-muted shrink-0" />
          </div>
        ))}
      </Panel>
    </div>
  )
}
