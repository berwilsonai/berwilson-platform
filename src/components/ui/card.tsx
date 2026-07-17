import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Panel — the app's one card language.
 * Top-level page panels: `<Panel>` (rounded-xl border bg-card elev-1).
 * Nested sub-blocks inside a panel: plain `rounded-md bg-muted/30` divs — no
 * border, no shadow (don't nest Panels).
 */
function Panel({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Adds hover lift. Use on clickable panels (wrapped in a Link/button). */
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card elev-1",
        interactive && "lift",
        className
      )}
      {...props}
    />
  )
}

/**
 * PanelHeader — the canonical small-caps header row: 11px muted label with an
 * optional tabular count, plus room for actions on the right.
 */
function PanelHeader({
  label,
  count,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  label: React.ReactNode
  count?: number | string
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border", className)} {...props}>
      <h2 className="label-caps text-muted-foreground flex items-center gap-1.5">
        {label}
        {count !== undefined && <span className="tnum font-medium normal-case tracking-normal">{count}</span>}
      </h2>
      {children}
    </div>
  )
}

export { Panel, PanelHeader }
