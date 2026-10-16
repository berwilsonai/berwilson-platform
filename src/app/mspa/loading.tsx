export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-0">
      <div className="h-7 w-56 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-32 w-full animate-pulse rounded-xl bg-muted" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  )
}
