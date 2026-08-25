'use client'

import { Button } from '@/components/ui/button'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-sm font-medium">Could not load leads</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{error.message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
