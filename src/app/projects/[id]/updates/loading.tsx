import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function UpdatesLoading() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="h-5 w-24 rounded bg-muted animate-pulse" />
        <div className="h-8 w-28 rounded bg-muted animate-pulse" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border p-4">
            <LoadingSkeleton lines={4} />
          </div>
        ))}
      </div>
    </div>
  )
}
