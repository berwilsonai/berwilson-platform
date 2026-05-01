import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function MilestonesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-5 w-24 rounded bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <LoadingSkeleton lines={2} />
          </div>
        ))}
      </div>
    </div>
  )
}
