import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function ProjectOverviewLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-border bg-card p-6">
            <LoadingSkeleton lines={5} />
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <LoadingSkeleton lines={4} />
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-6 h-32" />
          <div className="rounded-lg border border-border bg-card p-6 h-24" />
        </div>
      </div>
    </div>
  )
}
