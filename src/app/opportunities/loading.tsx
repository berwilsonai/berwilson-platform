export default function OpportunitiesLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 rounded bg-muted" />
        <div className="h-8 w-32 rounded bg-muted" />
      </div>
      <div className="flex gap-2">
        {[1, 2].map(i => (
          <div key={i} className="h-8 w-28 rounded bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card h-44" />
        ))}
      </div>
    </div>
  )
}
