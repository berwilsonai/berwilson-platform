export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      {/* Health panel skeleton */}
      <div className="rounded-lg border border-border bg-card elev-1 overflow-hidden animate-pulse">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="h-3 w-28 rounded bg-muted" />
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto] gap-5 items-center">
          <div className="flex flex-col items-center gap-2">
            <div className="size-[84px] rounded-full border-[7px] border-muted" />
            <div className="h-4 w-16 rounded-full bg-muted" />
          </div>
          <div className="hidden sm:block w-px self-stretch bg-border" />
          <div className="space-y-3 min-w-[200px]">
            <div className="h-3 w-24 rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="flex-1 h-1.5 rounded-full bg-muted" />
                <div className="h-3 w-4 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="hidden sm:block w-px self-stretch bg-border" />
          <div className="flex flex-col gap-4 min-w-[110px]">
            <div>
              <div className="h-2.5 w-20 rounded bg-muted" />
              <div className="h-8 w-24 rounded bg-muted mt-2" />
            </div>
            <div>
              <div className="h-2.5 w-20 rounded bg-muted" />
              <div className="h-8 w-10 rounded bg-muted mt-2" />
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border border-l-2 border-l-muted bg-card p-4 elev-1">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-8 w-16 rounded bg-muted mt-2" />
          </div>
        ))}
      </div>

      {/* Main content skeleton */}
      <div className="flex flex-col lg:flex-row gap-5 animate-pulse">
        {/* Project cards grid */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-7 w-32 rounded bg-muted" />
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
                    <div className="h-3 w-1/2 rounded bg-muted" />
                  </div>
                  <div className="h-4 w-14 rounded bg-muted" />
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <div key={j} className="flex-1 h-1.5 rounded-full bg-muted" />
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-3 w-12 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right sidebar skeleton */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 space-y-3">
          <div className="rounded-lg border border-border bg-card elev-1 p-4 space-y-3">
            <div className="h-4 w-28 rounded bg-muted" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-5 w-10 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-card elev-1">
            <div className="px-4 py-3 border-b border-border">
              <div className="h-4 w-32 rounded bg-muted" />
            </div>
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-muted" />
                  <div className="h-2.5 w-1/2 rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
