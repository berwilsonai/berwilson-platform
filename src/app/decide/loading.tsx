export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-10 w-48 rounded-lg bg-muted animate-pulse" />
      <div className="h-8 w-72 rounded-full bg-muted animate-pulse" />
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-3 space-y-2">
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
