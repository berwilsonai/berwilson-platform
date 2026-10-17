'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-0">
      <div className="rounded-xl border border-border bg-card p-6 elev-1">
        <h1 className="text-base font-semibold">The assessment could not be computed</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          The engine throws rather than returning a plausible number when an input is impossible —
          a PUE below 1.0 or a negative cost base, for instance. The message above names which.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex h-[2.75rem] items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
