'use client'

import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertCircle className="size-8 text-critical mb-4" />
      <p className="text-sm font-medium">Could not read the recordings&rsquo; attendees</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">{error.message}</p>
      <Button className="mt-6" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
