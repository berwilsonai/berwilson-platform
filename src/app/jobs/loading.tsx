/**
 * Mirrors the real page: heading, composer, then the recent list.
 *
 * ⚠ In the SEGMENT, never at a route group's root — a `loading.tsx` there 500s
 * the whole route, and a build that exits 0 having listed it is not evidence it
 * answers (§12).
 */
export default function JobsLoading() {
  return (
    <div className="max-w-3xl space-y-6 animate-pulse">
      <div>
        <div className="h-6 w-24 rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-prose rounded bg-muted/70" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="h-24 w-full rounded bg-muted/70" />
        <div className="h-8 w-32 rounded bg-muted" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-3 py-3 flex items-center gap-3">
              <div className="h-4 flex-1 rounded bg-muted/70" />
              <div className="h-5 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
