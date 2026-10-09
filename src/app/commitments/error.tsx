'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-xl border border-border bg-card p-6 elev-1">
        <h1 className="text-base font-semibold">The ledger could not be read</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
