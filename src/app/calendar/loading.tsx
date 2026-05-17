export default function CalendarLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted" />
        <div className="space-y-1.5">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="h-3 w-72 rounded bg-muted" />
        </div>
      </div>
      {/* Legend skeleton */}
      <div className="flex gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
      {/* Calendar weeks skeleton */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
