export default function SystemHealthLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-7 w-40 rounded bg-muted" />
        <div className="h-5 w-32 rounded bg-muted" />
      </div>
      <div className="rounded-xl border border-border bg-card h-80" />
    </div>
  )
}
