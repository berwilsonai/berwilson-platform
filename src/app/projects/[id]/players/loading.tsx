import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function PlayersLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-5 w-20 rounded bg-muted" />
        <div className="h-8 w-24 rounded bg-muted" />
      </div>
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="size-9 rounded-full bg-muted shrink-0" />
            <LoadingSkeleton lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}
