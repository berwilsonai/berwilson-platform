'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function VehiclesError({ error, reset }: ErrorProps) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <h2 className="mb-2 text-lg font-semibold">Could not load this deal&rsquo;s vehicles</h2>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        The read throws rather than returning nothing, deliberately: an empty list here would read
        as &ldquo;this deal has no SPVs&rdquo;, which is the one wrong answer. Try again.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9"
        >
          Try again
        </button>
        <button
          onClick={() => router.back()}
          className="inline-flex h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9"
        >
          Go back
        </button>
      </div>
    </div>
  )
}
