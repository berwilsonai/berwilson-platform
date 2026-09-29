'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 elev-1">
      <h2 className="text-sm font-medium">Could not load this project&rsquo;s land</h2>
      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      <button
        onClick={reset}
        className="mt-3 inline-flex h-9 items-center rounded-md border border-border px-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Try again
      </button>
    </div>
  )
}
