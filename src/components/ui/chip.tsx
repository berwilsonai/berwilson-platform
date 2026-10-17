import * as React from "react"

import { cn } from "@/lib/utils"
import { chipTone, isTone, type Tone } from "@/lib/ui/tone"

/**
 * Chip — the one badge/status-pill shell.
 *
 * `tone` takes either a TONE NAME or a legacy class triple, and that dual
 * acceptance is the migration bridge, not indecision:
 *
 *   <Chip tone="caution">On Hold</Chip>                     ← what new code writes
 *   <Chip tone={SECTOR_BADGE[project.sector]}>…</Chip>      ← the 192 existing uses
 *
 * A name resolves through `chipTone()` in `src/lib/ui/tone.ts`, where the
 * palette is declared literally and an unknown name throws. A string that is
 * not a known tone is passed through as classes, which is how the `*_BADGE`
 * maps keep working untouched while they are converted one file at a time.
 *
 * ⚠ THE TYPE IS `Tone | (string & {})` ON PURPOSE: that union gives
 * autocomplete for the thirteen names while still accepting any string. When
 * every map has been converted, narrowing this to `Tone` makes `tsc` enumerate
 * the stragglers — which is the only completion proof worth having, since a
 * grep cannot tell a converted map from an unconverted one.
 */
function Chip({
  tone,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  /** A tone name (preferred), or a legacy `bg-… text-… ring-…` triple. */
  tone?: Tone | (string & {})
}) {
  const resolved = tone ? (isTone(tone) ? chipTone(tone) : tone) : undefined

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        resolved ?? "bg-muted text-muted-foreground ring-border",
        className
      )}
      {...props}
    />
  )
}

export { Chip }
