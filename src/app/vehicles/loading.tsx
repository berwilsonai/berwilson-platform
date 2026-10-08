export default function VehiclesLoading() {
  return (
    <div className="animate-pulse space-y-6 py-6">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-muted" />
        <div className="space-y-2">
          <div className="h-6 w-40 rounded bg-muted" />
          <div className="h-4 w-80 max-w-full rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-border bg-card" />
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="h-40 rounded-xl border border-border bg-card" />
      ))}
    </div>
  )
}
