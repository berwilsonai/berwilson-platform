'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * /tasks had no error boundary at all, despite being one of the five routes in
 * the mobile tab bar. A throw here fell through to the root boundary, which
 * replaces the whole page rather than the board.
 */
export default function TasksError({
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
      <h2 className="text-lg font-semibold mb-2">Could not load the task board</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        No task has been changed. If this persists, the board is also published as a Google Sheet.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center h-[2.75rem] sm:h-9 px-4 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Try again
      </button>
    </div>
  )
}
