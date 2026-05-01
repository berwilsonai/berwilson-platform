import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function EditProjectLoading() {
  return (
    <div className="max-w-2xl space-y-6 animate-pulse">
      <div className="h-7 w-36 rounded bg-muted" />
      <div className="rounded-lg border border-border bg-card p-6">
        <LoadingSkeleton lines={10} />
      </div>
    </div>
  )
}
