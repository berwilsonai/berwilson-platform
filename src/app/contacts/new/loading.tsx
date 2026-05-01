import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function NewContactLoading() {
  return (
    <div className="max-w-xl space-y-6 animate-pulse">
      <div className="h-7 w-36 rounded bg-muted" />
      <div className="rounded-lg border border-border bg-card p-6">
        <LoadingSkeleton lines={8} />
      </div>
    </div>
  )
}
