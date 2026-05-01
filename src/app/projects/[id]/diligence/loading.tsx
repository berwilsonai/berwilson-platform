import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function DiligenceLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex gap-2 border-b border-border pb-2">
        <div className="h-8 w-32 rounded bg-muted" />
        <div className="h-8 w-32 rounded bg-muted" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <LoadingSkeleton lines={2} />
          </div>
        ))}
      </div>
    </div>
  )
}
