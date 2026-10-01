export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-80 rounded bg-muted" />
      <div className="h-8 w-96 rounded bg-muted" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 rounded-xl border border-border bg-card" />
        ))}
      </div>
    </div>
  )
}
