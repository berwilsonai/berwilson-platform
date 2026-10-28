import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Panel — the app's one card language.
 * Top-level page panels: `<Panel>` (rounded-lg border bg-card elev-1).
 * Nested sub-blocks inside a panel: plain `rounded-md bg-muted/30` divs — no
 * border, no shadow (don't nest Panels).
 *
 * ⚠ `rounded-lg` IS `--radius` EXACTLY, AND THAT IS THE POINT. This was
 * `rounded-xl` (calc(--radius * 1.4)) while 145 hand-rolled shells used
 * `rounded-lg`, so two card radii showed on one screen. 85 outliers were
 * converged by scripts/codemod/card-radius.mjs.
 *
 * ⚠ THE TWO FIGURES THIS COMMENT USED TO QUOTE WERE BOTH STALE, which is the
 * §12 failure where a comment outlives what it describes and is believed
 * anyway. It said "--radius is 0.25rem, which makes this 4px": `--radius`
 * became 0.5rem on 10-26, so it is 8px, and `rounded-xl` is 11.2px. It also
 * said "`elev-1` is transparent at rest, so the border is what separates a
 * card from the canvas" — elev-1 became a real two-layer shadow in BOTH
 * themes on 10-26. The border and the shadow now share that job. Read the
 * tokens in globals.css; do not trust a number written here.
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
        "rounded-lg border border-border bg-card elev-1",
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
