export default function UsersSettingsLoading() {
  return (
    <div className="space-y-5 max-w-4xl animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-40 rounded bg-muted" />
        <div className="h-8 w-28 rounded bg-muted" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card h-20" />
      ))}
    </div>
  )
}
