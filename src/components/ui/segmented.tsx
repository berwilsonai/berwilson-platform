'use client'

/**
 * Segmented — the view switcher.
 *
 * Lifted out of `SteelPipelineBoard`, where it was defined locally and so was
 * reachable by exactly one of the five board surfaces (§12: a shared renderer
 * wired to one surface is worse than no shared renderer). Attio's most-praised
 * single feature is that a list switches between table, board and calendar
 * instantly; this is the control that offers it, so it has to be shareable.
 *
 * ⚠ THE ORIGINAL WAS 24.6px TALL. `h-7` is `calc(var(--spacing) * 7)` and
 * `--spacing` is 0.22rem here, so the control sat well under the 44px touch
 * floor — the same spacing-derived tap-target bug the 10-17 density change hit
 * in 66 places (§12). The target is absolute below md and compact above it,
 * where a pointer does not need the room.
 */

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Optional count shown after the label — a board/table switch usually wants it. */
  count?: number
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  /** Accessible name for the group — a bare row of buttons says nothing. */
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly SegmentedOption<T>[]
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      /*
        ⚠ A GREY TRACK, NOT A BORDERED BOX ON THE CANVAS — paired with the
        raised white pill below. See the note on the active state.
      */
      className={cn(
        'inline-flex items-center rounded-md bg-muted p-0.5',
        className
      )}
    >
      {options.map(({ value: v, label: optLabel, icon: Icon, count }) => {
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            // The pressed state is the only thing distinguishing these for a
            // screen reader; colour alone cannot carry it.
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
              'h-[2.75rem] md:h-7',
              'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              /*
                ⚠ THE ACTIVE SEGMENT IS A RAISED WHITE PILL, NOT A BRAND FILL
                (2026-10-27). It was `bg-primary text-primary-foreground`, so
                every view switcher on every page wore a solid terracotta
                block. §12 on this exact token: *"Keep it scarce: it means
                'this is the action'."* A sort order is not an action, it is a
                view state — and on the dashboard three of these sat in one row
                beside a real primary button, so nothing in the row read as the
                thing to press.

                A white pill lifting off a grey track is the idiom every
                reference app in the brief uses, and it reads as "selected"
                without spending the one colour the palette has.
              */
              active
                ? 'bg-card text-foreground elev-1'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon size={13} aria-hidden="true" />}
            {optLabel}
            {count !== undefined && <span className="tnum opacity-70">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
