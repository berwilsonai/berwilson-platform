import LoadingSkeleton from './LoadingSkeleton'

/**
 * The loading shapes a record tab can have.
 *
 * ⚠ A `loading.tsx` ONE LEVEL UP DOES NOT COVER A TAB SWITCH. A loading
 * boundary belongs to its own segment, and sibling navigation (Players →
 * Tasks) only re-shows boundaries inside the segment that CHANGED — so
 * `opportunities/[id]/loading.tsx` fires on the first load of the record and
 * never again, however many tabs the reader clicks. That is why
 * `projects/[id]` carries thirteen per-tab files, and why the opportunity tab
 * family showing nothing on a click was not a missing boundary but a missing
 * boundary PER TAB.
 *
 * These are the four shapes those thirteen files were hand-writing. A tab's
 * `loading.tsx` is now one line naming its shape, so adding a tab cannot
 * quietly ship without a loading state again.
 *
 * ⚠⚠ NEVER PUT A `loading.tsx` AT THE ROOT OF A ROUTE GROUP. One at
 * `opportunities/[id]/(detail)/loading.tsx` — beside that group's own
 * `page.tsx` — builds green (exit 0, every route listed) and then answers
 * every request to `/opportunities/[id]` with a 500:
 *   Invariant: The client reference manifest for route "/opportunities/[id]"
 *   does not exist.
 * The manifest is emitted at the GROUPED path and the runtime looks for it at
 * the de-grouped one. A boundary inside a group's SUBSEGMENT
 * (`(detail)/tasks/loading.tsx`) is fine — all eleven of those are live. Took
 * the opportunity record down in production for four minutes on 2026-10-09.
 */

/** A header row plus a bordered list of rows — players, tasks, meetings, milestones. */
export function ListTabSkeleton({ rows = 5, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-8 w-24 rounded bg-muted" />
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            {avatar && <div className="size-9 rounded-full bg-muted shrink-0" />}
            <LoadingSkeleton lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Stacked panels of prose/figures — economics, financing, the overview. */
export function PanelsTabSkeleton({ panels = 2, lines = 6 }: { panels?: number; lines?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: panels }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5">
          <LoadingSkeleton lines={lines} />
        </div>
      ))}
    </div>
  )
}

/** An upload target above a file list — the Documents tab. */
export function DocumentsTabSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 w-28 rounded bg-muted" />
        <div className="h-8 w-28 rounded bg-muted" />
      </div>
      <div className="h-32 rounded-xl border-2 border-dashed border-border bg-muted/30" />
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="size-8 rounded bg-muted shrink-0" />
            <LoadingSkeleton lines={2} className="flex-1" />
            <div className="h-6 w-20 rounded bg-muted shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A checklist / register with a status column — diligence, entities. */
export function ChecklistTabSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 rounded bg-muted" />
        <div className="h-8 w-28 rounded bg-muted" />
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="size-4 rounded bg-muted shrink-0" />
            <div className="h-4 flex-1 rounded bg-muted" />
            <div className="h-5 w-16 rounded-full bg-muted shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
