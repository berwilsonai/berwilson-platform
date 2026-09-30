export default function LeadCategoriesLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-muted" />
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-muted" />
          <div className="h-4 w-80 rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg border border-border bg-card" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-24 rounded-lg border border-border bg-card" />
      ))}
    </div>
  )
}
