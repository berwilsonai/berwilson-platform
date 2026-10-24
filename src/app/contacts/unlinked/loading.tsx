export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-56 rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-md bg-muted" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-36 rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  )
}
