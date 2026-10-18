import { Panel } from '@/components/ui/card'

/**
 * Mirrors the real page: header, chip row, then ranked rows.
 *
 * Uses `Panel` rather than imitating its class string, because a skeleton whose
 * job is to match the real markup should be built from the same primitive — if
 * Panel's radius or border changes, this follows for free.
 */
export default function AttentionLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div>
        <div className="h-6 w-40 rounded bg-muted" />
        <div className="mt-2 h-4 w-full max-w-prose rounded bg-muted/70" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-6 w-28 rounded-md bg-muted" />
        ))}
      </div>
      <Panel className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-4 w-32 rounded bg-muted/70" />
              </div>
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted/70" />
            </div>
            <div className="h-4 w-7 rounded bg-muted" />
          </div>
        ))}
      </Panel>
    </div>
  )
}
