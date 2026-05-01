import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function ReviewLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-7 w-40 rounded bg-muted" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <LoadingSkeleton lines={4} />
          </div>
        ))}
      </div>
    </div>
  )
}
