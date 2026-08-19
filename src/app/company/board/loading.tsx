export default function BoardLoading() {
  return (
    <div className="space-y-8 max-w-3xl animate-pulse">
      <div className="h-10 w-72 rounded bg-muted" />
      <div className="h-8 w-64 rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-card" />
        ))}
      </div>
    </div>
  )
}
