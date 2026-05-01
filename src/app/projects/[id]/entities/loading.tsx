import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function EntitiesLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-5 w-24 rounded bg-muted" />
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4">
            <LoadingSkeleton lines={2} />
          </div>
        ))}
      </div>
    </div>
  )
}
