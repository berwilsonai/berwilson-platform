import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * ⚠ THE CUSTOM FONT-SIZE ROLES MUST BE DECLARED HERE OR THEY SILENTLY VANISH.
 *
 * `text-*` is ambiguous in Tailwind: `text-sm` is a size and `text-foreground`
 * is a colour. tailwind-merge tells them apart with a BUILT-IN LIST of size
 * names — sm, base, lg, xl, 2xl and the rest — and anything else beginning
 * `text-` is classified as a colour. So the moment `globals.css` added the
 * role tokens (`text-display`, `text-title`, `text-caption`, `text-metric`),
 * every one of them landed in the colour group, and a `cn()` call that also
 * set an ink deleted the size.
 *
 * Measured the hour it shipped: `StatTile` renders
 * `cn('tnum mt-1 text-metric', TONE[tone])` where TONE is `text-foreground`.
 * The dashboard's four KPI figures went from 28px to **16px** — the inherited
 * body size, because the class had been dropped entirely. Typecheck green,
 * build green, both classes present in the source. This is §12's `cn()` rule
 * ("two classes in the same utility group do not compose — the later one
 * silently deletes the earlier") arriving through a group the author never
 * chose and cannot see.
 *
 * Adding a `--text-<name>` token to `globals.css` therefore means adding the
 * name here in the same commit. `conventions.test.ts` asserts the two lists
 * agree, so the build names the omission rather than a page quietly losing a
 * size.
 */
export const TYPE_ROLES = ["display", "title", "metric", "caption"] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_ROLES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
