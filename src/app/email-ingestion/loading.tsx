export default function EmailIngestionLoading() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded bg-muted" />
        <div className="h-4 w-full max-w-lg rounded bg-muted" />
      </div>
      <div className="h-72 rounded-lg border border-border bg-card" />
    </div>
  )
}
