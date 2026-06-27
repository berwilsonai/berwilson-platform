export default function OpportunityDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-5 w-32 rounded bg-muted" />
          <div className="h-7 w-72 rounded bg-muted" />
        </div>
        <div className="h-8 w-48 rounded bg-muted" />
      </div>
      <div className="h-1.5 w-full rounded bg-muted" />
      <div className="rounded-lg border border-border bg-card h-28" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card h-32" />
        <div className="rounded-lg border border-border bg-card h-32" />
      </div>
    </div>
  )
}
