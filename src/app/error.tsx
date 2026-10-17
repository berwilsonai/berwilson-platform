'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

// Named for what it is: the boundary INSIDE the root layout. The one that
// catches the layout itself failing is `global-error.tsx`, added 2026-10-17.
export default function RootError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] py-20 text-center px-4">
      <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        An unexpected error occurred. Your data is safe — this is likely a temporary issue.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
