export default function ProjectsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 rounded bg-muted" />
        <div className="h-8 w-28 rounded bg-muted" />
      </div>
      {/* Filters */}
      <div className="flex gap-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-8 w-28 rounded bg-muted" />
        ))}
      </div>
      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card h-36" />
        ))}
      </div>
    </div>
  )
}
