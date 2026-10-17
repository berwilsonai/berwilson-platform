/**
 * Read the theme tokens out of `globals.css`, for things that need to MEASURE
 * the palette rather than merely use it.
 *
 * ⚠ ONE IMPLEMENTATION, TWO CALLERS, DELIBERATELY. `tone.test.ts` asserts the
 * contrast thresholds and `/settings/ui` prints the measured ratios on screen.
 * If each parsed the CSS its own way they could disagree, and the screen that
 * exists to tell the truth about the palette would be the one that was wrong
 * (§12: grep for a renderer before building one).
 *
 * The CSS is the source of truth, not a duplicated table in TypeScript — a
 * second copy of the palette is a second palette.
 */

import { readFileSync } from 'node:fs'

import { contrastOklch } from './contrast'

export type ThemeName = 'light' | 'dark'

const BLOCK: Record<ThemeName, string> = { light: ':root', dark: '.dark' }

const cache = new Map<string, Record<string, string>>()

/** Every `--token: value;` inside the first block matching `selector`. */
export function readBlock(selector: string, cssPath = 'src/app/globals.css'): Record<string, string> {
  const key = `${cssPath}::${selector}`
  const hit = cache.get(key)
  if (hit) return hit
  const css = readFileSync(cssPath, 'utf8')
  const out: Record<string, string> = {}
  const start = css.indexOf(`${selector} {`)
  if (start !== -1) {
    const end = css.indexOf('\n}', start)
    for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim()
    }
  }
  cache.set(key, out)
  return out
}

/** Every `--token: value;` in the `:root` and `.dark` blocks. */
export function readThemeTokens(cssPath = 'src/app/globals.css') {
  return {
    light: readBlock(BLOCK.light, cssPath),
    dark: readBlock(BLOCK.dark, cssPath),
  }
}

export interface ToneMeasurement {
  tone: string
  theme: ThemeName
  /** ink against the card surface */
  inkOnCard: number | null
  /** ink against its own tinted surface — the chip case */
  inkOnSurface: number | null
  /** the tinted surface against the card */
  surfaceOnCard: number | null
  /** the tinted surface against the page canvas, where it reads weakest */
  surfaceOnCanvas: number | null
  /** the ring against the card */
  edgeOnCard: number | null
}

/** The four status tones that own a full ink/surface/edge triple. */
export const MEASURED_TONES = ['positive', 'caution', 'critical', 'info'] as const

export function measureTones(cssPath?: string): ToneMeasurement[] {
  const t = readThemeTokens(cssPath)
  const out: ToneMeasurement[] = []
  for (const theme of ['light', 'dark'] as ThemeName[]) {
    const card = t[theme]['card']
    const canvas = t[theme]['background']
    for (const tone of MEASURED_TONES) {
      const ink = t[theme][tone]
      const surface = t[theme][`${tone}-surface`]
      const edge = t[theme][`${tone}-edge`]
      const safe = (a?: string, b?: string) => {
        if (!a || !b) return null
        try {
          return contrastOklch(a, b)
        } catch {
          return null
        }
      }
      out.push({
        tone,
        theme,
        inkOnCard: safe(ink, card),
        inkOnSurface: safe(ink, surface),
        surfaceOnCard: safe(surface, card),
        surfaceOnCanvas: safe(surface, canvas),
        edgeOnCard: safe(edge, card),
      })
    }
  }
  return out
}
