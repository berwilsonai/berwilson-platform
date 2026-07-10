export default function InvestorDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-48 rounded bg-muted" />
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="h-7 w-72 rounded bg-muted" />
        </div>
        <div className="h-8 w-56 rounded bg-muted" />
      </div>
      <div className="h-2 w-full rounded bg-muted" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="h-32 rounded-lg border border-border bg-card" />
      <div className="h-48 rounded-lg border border-border bg-card" />
    </div>
  )
}
