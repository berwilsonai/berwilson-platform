import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function IntelLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-7 w-20 rounded bg-muted" />
      <div className="h-24 rounded-lg border border-border bg-card" />
      <div className="rounded-lg border border-border bg-card p-6">
        <LoadingSkeleton lines={6} />
      </div>
    </div>
  )
}
