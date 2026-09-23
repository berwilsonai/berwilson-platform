export default function Loading() {
  return (
    <div className="max-w-4xl space-y-4">
      <div className="h-7 w-48 rounded bg-muted animate-pulse" />
      <div className="h-4 w-96 rounded bg-muted animate-pulse" />
      <div className="h-64 rounded-xl border border-border bg-card" />
    </div>
  )
}
