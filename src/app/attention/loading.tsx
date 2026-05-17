export default function AttentionLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted" />
        <div className="space-y-1.5">
          <div className="h-5 w-64 rounded bg-muted" />
          <div className="h-3 w-80 rounded bg-muted" />
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-5 w-20 rounded bg-muted" />
            <div className="h-5 w-16 rounded bg-muted" />
          </div>
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-3/4 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
