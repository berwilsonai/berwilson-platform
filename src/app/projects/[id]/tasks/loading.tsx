import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function TasksLoading() {
  return (
    <div className="space-y-4 max-w-3xl animate-pulse">
      <div className="h-5 w-28 rounded bg-muted" />
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="size-4 rounded bg-muted shrink-0 mt-0.5" />
            <LoadingSkeleton lines={1} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}
