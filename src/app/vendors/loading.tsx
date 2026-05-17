export default function VendorsLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div className="h-5 w-36 rounded bg-muted" />
        <div className="h-8 w-24 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
            </div>
            <div className="h-3 w-full rounded bg-muted" />
            <div className="flex gap-1">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-5 w-16 rounded bg-muted" />
              ))}
            </div>
            <div className="pt-2 border-t border-border flex justify-between">
              <div className="h-3 w-20 rounded bg-muted" />
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
