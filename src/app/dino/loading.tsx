export default function DinoLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-9 w-72 rounded bg-muted" />
        <div className="h-8 w-40 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="h-48 rounded-xl border border-border bg-card" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 h-64 rounded-xl border border-border bg-card" />
        <div className="h-64 rounded-xl border border-border bg-card" />
      </div>
    </div>
  )
}
