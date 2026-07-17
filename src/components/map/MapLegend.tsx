'use client'

// Decodes the marker language for an outside audience: solid vs outlined
// pucks (awarded vs pipeline work) and the value-scaled sizes. Rendered by
// MapPageClient bottom-right, visible in present mode — that's who it's for.
export default function MapLegend() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground elev-1">
      <span className="flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-full bg-slate-600 ring-1 ring-white dark:bg-slate-400 dark:ring-slate-900" />
        Awarded / underway
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-full bg-card ring-1 ring-slate-600 dark:ring-slate-400" />
        Pipeline / bidding
      </span>
      <span className="h-3.5 w-px bg-border" />
      <span
        className="flex items-center gap-1.5"
        title="<$100M · $100M–$1B · $1B–$10B · $10B+"
      >
        <span className="flex items-end gap-1">
          <span className="size-1.5 rounded-full bg-slate-400" />
          <span className="size-2.5 rounded-full bg-slate-400" />
          <span className="size-3.5 rounded-full bg-slate-400" />
        </span>
        Sized by value
      </span>
    </div>
  )
}
