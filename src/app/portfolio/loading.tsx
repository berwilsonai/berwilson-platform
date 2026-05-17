export default function PortfolioLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-7 w-28 rounded bg-muted" />
        <div className="h-4 w-64 rounded bg-muted mt-2" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 rounded bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
            <div className="h-3 w-1/3 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
