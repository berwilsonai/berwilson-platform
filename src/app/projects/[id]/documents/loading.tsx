export default function DocumentsLoading() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="h-5 w-28 rounded bg-muted animate-pulse" />
        <div className="h-8 w-28 rounded bg-muted animate-pulse" />
      </div>
      <div className="h-32 rounded-lg border-2 border-dashed border-border bg-muted/30 animate-pulse" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                <div className="h-3 w-32 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-6 w-20 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
