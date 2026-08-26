'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-3">
      <h2 className="text-lg">Could not load the decision list</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button
        onClick={reset}
        className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
      >
        Try again
      </button>
    </div>
  )
}
