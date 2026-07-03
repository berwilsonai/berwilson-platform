'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ObjectivesError({ error, reset }: ErrorProps) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Failed to load objectives</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        Could not fetch your objectives. If you just deployed, make sure the
        objectives migration has been applied to the database.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          Try again
        </button>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
        >
          Dashboard
        </button>
      </div>
    </div>
  )
}
