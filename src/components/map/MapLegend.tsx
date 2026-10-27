'use client'

// Decodes the marker language for an outside audience: solid vs outlined
// pucks (awarded vs pipeline work) and the value-scaled sizes. Rendered by
// MapPageClient bottom-right, visible in present mode — that's who it's for.
import type { RailMode } from '@/lib/map/constants'

export default function MapLegend({ railMode }: { railMode: RailMode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground elev-1">
      <span className="flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-full bg-muted-foreground ring-1 ring-white dark:ring-border" />
        Awarded / underway
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-full bg-card ring-1 ring-border" />
        Pipeline / bidding
      </span>
      <span className="h-3.5 w-px bg-border" />
      <span
        className="flex items-center gap-1.5"
        title="<$100M · $100M–$1B · $1B–$10B · $10B+"
      >
        <span className="flex items-end gap-1">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          <span className="size-2.5 rounded-full bg-muted-foreground" />
          <span className="size-3.5 rounded-full bg-muted-foreground" />
        </span>
        Sized by value
      </span>
      {railMode !== 'off' && (
        <>
          <span className="h-3.5 w-px bg-border" />
          <span className="flex items-center gap-1.5" title="Strategic Rail Corridor Network">
            <span className="h-0.5 w-4 shrink-0 rounded-full bg-muted-foreground dark:bg-muted" />
            STRACNET
          </span>
          {railMode === 'all' && (
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 shrink-0 bg-muted-foreground" />
              Other rail
            </span>
          )}
        </>
      )}
    </div>
  )
}
