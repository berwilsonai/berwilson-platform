export default function JobLoading() {
  return (
    <div className="max-w-3xl space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-6 w-2/3 rounded bg-muted" />
        <div className="h-3 w-40 rounded bg-muted/70" />
      </div>
      <div className="h-20 w-full rounded-lg bg-muted/50" />
      <div className="space-y-1.5">
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="h-40 w-full rounded-lg bg-muted/40" />
      </div>
    </div>
  )
}
