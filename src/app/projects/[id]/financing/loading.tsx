import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function FinancingLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <LoadingSkeleton lines={6} />
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <LoadingSkeleton lines={6} />
        </div>
      </div>
    </div>
  )
}
