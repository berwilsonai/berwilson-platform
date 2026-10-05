import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function EconomicsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-xl border border-border bg-card p-5">
        <LoadingSkeleton lines={8} />
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        <LoadingSkeleton lines={5} />
      </div>
    </div>
  )
}
