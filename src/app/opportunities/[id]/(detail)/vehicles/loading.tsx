import LoadingSkeleton from '@/components/shared/LoadingSkeleton'

export default function VehiclesLoading() {
  return (
    <div className="space-y-4 py-6 animate-pulse">
      {/* Three, because three is the shape of the answer on a development site. */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5">
          <LoadingSkeleton lines={4} />
        </div>
      ))}
    </div>
  )
}
