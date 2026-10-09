export default function Loading() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  )
}
