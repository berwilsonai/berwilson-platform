export default function ObjectivesLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-32 rounded bg-muted" />
        <div className="h-9 w-28 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card h-64" />
        ))}
      </div>
    </div>
  )
}
