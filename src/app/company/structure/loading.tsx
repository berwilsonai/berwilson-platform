export default function CompanyStructureLoading() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted" />
        <div className="space-y-1.5">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-3 w-64 rounded bg-muted" />
        </div>
      </div>
      <div className="h-9 w-56 rounded bg-muted" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="h-24 rounded-xl bg-muted" />
        <div className="h-24 rounded-xl bg-muted" />
      </div>
      <div className="h-48 rounded-xl bg-muted" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-20 rounded-xl bg-muted" />
      ))}
    </div>
  )
}
