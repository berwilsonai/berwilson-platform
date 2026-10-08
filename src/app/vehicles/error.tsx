'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
      <h2 className="mb-2 text-lg font-semibold">Could not load the vehicles</h2>
      {/*
        The reader is told which possibility to check rather than left with a
        bare failure: this page reads `project_spvs` and
        `project_spv_participants`, so a fresh deploy whose migration has not
        been applied is the likeliest cause — and the loaders THROW on a
        database error rather than returning an empty list, precisely so this
        screen appears instead of "Ber Wilson is in no vehicles".
      */}
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        The vehicle tables could not be read. If you have just deployed, check that the
        `project_spvs` migration has been applied.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => router.push('/dashboard')}>
          Dashboard
        </Button>
      </div>
    </div>
  )
}
