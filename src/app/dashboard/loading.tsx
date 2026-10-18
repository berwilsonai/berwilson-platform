/**
 * The dashboard's skeleton, and it has to MIRROR the dashboard.
 *
 * ⚠ IT PROMISED A GAUGE THAT NO LONGER EXISTS. Until 2026-10-17 this drew an
 * 84px radial dial and a four-row bar list — the synthetic health score that was
 * removed from `HealthPanel` on 2026-07-03 — plus a separate row of four stat
 * cards that is not on the page either. So every dashboard load animated one
 * layout and then snapped to a different one. A skeleton that does not match is
 * worse than none: it spends the wait teaching the reader the wrong shape.
 *
 * Shapes tracked here, and what they must stay in step with:
 *   greeting      → page.tsx `h1 text-2xl` + date line
 *   KPI band      → HealthPanel's `rounded-xl … px-5 py-4 sm:px-6` + `<dl>` grid
 *   brief bar     → DailyBrief collapsed (`rounded-xl border-primary/20`, px-4 py-3)
 *   main area     → `flex-col lg:flex-row gap-6`, rail at `lg:w-72 xl:w-80`
 *
 * Three KPI tiles, not four: the Weighted Pipeline tile suppresses itself while
 * no project carries a win probability, which is the current state of the data.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">

      {/* Greeting */}
      <div>
        <div className="h-7 w-64 rounded bg-muted" />
        <div className="mt-2 h-4 w-48 rounded bg-muted/70" />
      </div>

      {/* KPI band — HealthPanel */}
      <div className="rounded-lg border border-border bg-card elev-1 px-5 py-4 sm:px-6">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="min-w-0 flex items-start gap-3">
              <div className="mt-0.5 size-9 shrink-0 rounded-lg bg-muted" />
              <div className="min-w-0 flex-1">
                <div className="h-2.5 w-24 rounded bg-muted" />
                <div className="mt-2 h-8 w-28 rounded bg-muted" />
                <div className="mt-1.5 h-2.5 w-36 rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Intelligence brief — collapsed */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.03] elev-1 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="size-4 rounded bg-muted" />
          <div className="h-3.5 w-40 rounded bg-muted" />
          <div className="ml-auto h-3 w-16 rounded bg-muted/70" />
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Project cards */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-7 w-36 rounded bg-muted" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card elev-1 p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-12 rounded bg-muted" />
                  <div className="h-5 w-14 rounded bg-muted" />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-3/4 rounded bg-muted" />
                    <div className="h-3 w-1/2 rounded bg-muted/70" />
                  </div>
                  <div className="h-4 w-14 rounded bg-muted" />
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <div key={j} className="flex-1 h-1.5 rounded-full bg-muted" />
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <div className="h-3 w-24 rounded bg-muted/70" />
                  <div className="h-3 w-12 rounded bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rail — Commitments, then Needs Attention */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 space-y-3">
          <div className="rounded-lg border border-border bg-card elev-1 p-4 space-y-3">
            <div className="h-3 w-28 rounded bg-muted" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="h-3 flex-1 rounded bg-muted/70" />
                <div className="h-5 w-10 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-card elev-1">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <div className="size-3.5 rounded bg-muted" />
              <div className="h-3 w-28 rounded bg-muted" />
              <div className="ml-auto h-4 w-7 rounded bg-muted" />
            </div>
            <div className="p-3 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-md bg-muted/30 p-3 space-y-2">
                  <div className="h-2.5 w-24 rounded bg-muted" />
                  <div className="h-3 w-3/4 rounded bg-muted/70" />
                  <div className="h-2.5 w-1/2 rounded bg-muted/70" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
