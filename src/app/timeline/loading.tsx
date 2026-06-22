export default function TimelineLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted" />
        <div className="space-y-1.5">
          <div className="h-5 w-44 rounded bg-muted" />
          <div className="h-3 w-80 rounded bg-muted" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-7 w-24 rounded-full bg-muted" />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-8 w-44 rounded bg-muted" />
            <div className="h-2 flex-1 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
