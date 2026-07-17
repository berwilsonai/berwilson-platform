import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Chip — the one badge/status-pill shell. Color comes from the centralized
 * `*_BADGE` maps in `src/lib/utils/constants.ts` (bg/text/ring triples with
 * dark variants), passed via `tone`.
 *
 *   <Chip tone={SECTOR_BADGE[project.sector]}>{SECTOR_SHORT[project.sector]}</Chip>
 */
function Chip({
  tone,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  /** A `*_BADGE` color string: `bg-… text-… ring-… dark:…` */
  tone?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tone ?? "bg-muted text-muted-foreground ring-border",
        className
      )}
      {...props}
    />
  )
}

export { Chip }
