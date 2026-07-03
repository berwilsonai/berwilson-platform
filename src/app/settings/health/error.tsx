'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function SystemHealthError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Failed to load system health</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        The health checks themselves failed — that usually means the database is unreachable.
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
