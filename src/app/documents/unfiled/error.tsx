'use client'

import { Panel } from '@/components/ui/card'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Panel className="p-6 space-y-3">
      <h2 className="text-lg">Could not load the unfiled files</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button
        onClick={reset}
        className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Try again
      </button>
    </Panel>
  )
}
