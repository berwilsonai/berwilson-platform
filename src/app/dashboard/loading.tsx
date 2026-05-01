export default function DashboardLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 h-20" />
        ))}
      </div>

      {/* Main */}
      <div className="flex flex-col lg:flex-row gap-5">
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card h-36" />
          ))}
        </div>
        <div className="w-full lg:w-72 xl:w-80 shrink-0 rounded-lg border border-border bg-card h-64" />
      </div>
    </div>
  )
}
