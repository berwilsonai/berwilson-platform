export default function CompanyLoading() {
  return (
    <div className="space-y-8 max-w-3xl animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted" />
        <div className="space-y-1.5">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="h-48 w-full rounded-lg bg-muted" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-3 w-48 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
