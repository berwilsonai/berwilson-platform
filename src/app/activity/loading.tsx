import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function ActivityLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-7 w-28 rounded bg-muted" />
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <LoadingSkeleton lines={2} />
          </div>
        ))}
      </div>
    </div>
  )
}
