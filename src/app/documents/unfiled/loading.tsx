export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-10 w-56 rounded-lg bg-muted animate-pulse" />
      <div className="h-4 w-80 rounded-full bg-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2">
            <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
