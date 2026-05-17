export default function EmailLogLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-5 w-24 rounded bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
        </div>
        <div className="h-8 w-28 rounded bg-muted" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 w-24 rounded-full bg-muted" />
        ))}
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/50 border-b border-border p-3 flex gap-4">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-3 w-40 rounded bg-muted flex-1" />
          <div className="h-3 w-16 rounded bg-muted" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-border p-3 flex gap-4">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-3 w-48 rounded bg-muted flex-1" />
            <div className="h-5 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
