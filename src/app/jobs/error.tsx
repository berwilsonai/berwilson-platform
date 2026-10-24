'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] py-20 text-center px-4">
      <div className="size-12 rounded-full bg-critical-surface flex items-center justify-center mb-4">
        <AlertTriangle className="size-6 text-critical" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Could not read the job list</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        No job was started or changed by this. Any job already running keeps going — it runs in
        its own pass, not in this page.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center h-[2.75rem] sm:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Try again
      </button>
    </div>
  )
}
