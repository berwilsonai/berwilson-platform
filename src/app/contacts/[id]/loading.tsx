import { Panel } from '@/components/ui/card'

/**
 * Mirrors the contact page: avatar, name, the tab bar, then a 2/1 column split.
 *
 * ⚠ IT WAS A BARE `<LoadingSkeleton />` — three grey bars — on the page with
 * the highest await count in the repo (18, and until 10-17 none of them
 * parallel). So the slowest route in the app also had the least informative
 * wait, which is the worst possible pairing: the reader got no idea what was
 * coming and had the longest time to wonder.
 */
export default function ContactDetailLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Avatar + name + affiliation */}
      <div className="flex items-start gap-4">
        <div className="size-16 rounded-full bg-muted shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-7 w-56 rounded bg-muted" />
          <div className="h-4 w-72 rounded bg-muted/70" />
          <div className="flex gap-2 pt-1">
            <div className="h-5 w-20 rounded bg-muted" />
            <div className="h-5 w-24 rounded bg-muted" />
          </div>
        </div>
        <div className="hidden sm:flex gap-2 shrink-0">
          <div className="h-8 w-20 rounded-md bg-muted" />
          <div className="h-8 w-24 rounded-md bg-muted" />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-4 border-b border-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 w-20 rounded bg-muted mb-2.5" />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Panel key={i} className="p-4 space-y-3">
              <div className="h-3 w-28 rounded bg-muted" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="space-y-1.5">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted/70" />
                </div>
              ))}
            </Panel>
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Panel key={i} className="p-4 space-y-2.5">
              <div className="h-3 w-24 rounded bg-muted" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between gap-2">
                  <div className="h-3 flex-1 rounded bg-muted/70" />
                  <div className="h-3 w-12 rounded bg-muted" />
                </div>
              ))}
            </Panel>
          ))}
        </div>
      </div>
    </div>
  )
}
