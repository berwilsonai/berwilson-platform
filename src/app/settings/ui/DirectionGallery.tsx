import Link from 'next/link'

import { contrastOklch } from '@/lib/ui/contrast'
import { readDirectionTokens, readThemeTokens, type ThemeName } from '@/lib/ui/tokens'
import { Panel } from '@/components/ui/card'
import DirectionPreview from './DirectionPreview'

/**
 * The three candidate directions, each rendered on the same real deal screen,
 * in both themes, beside the current look.
 *
 * ⚠ THE CURRENT LOOK IS INCLUDED DELIBERATELY. Three options with nothing to
 * measure them against is a mood board; the question is not "which of these
 * three" but "is any of them better than what is already shipping".
 *
 * Temporary scaffolding — see the docblock in `directions.css`.
 */

export interface Direction {
  id: string | null
  name: string
  thesis: string
  tradeoff: string
  numbers: string
}

const DIRECTIONS: Direction[] = [
  {
    id: null,
    name: 'Current',
    thesis: 'What ships today: navy primary on a faintly cool canvas, a warm cream hover, 12px radius, two-layer tinted elevation.',
    tradeoff: 'Nothing to relearn. The type above sm was never tokenised, so the top end reads unconsidered — 69 headings in 25 spellings.',
    numbers: 'radius 12px · spacing 4px · elevation two-layer',
  },
  {
    id: 'a',
    name: 'A — Institutional',
    thesis: 'The same navy lineage taken to its serious end. Cooler neutrals, a tight 6px radius, elevation cut almost to hairlines so the borders carry the structure, spacing pulled in 6%.',
    tradeoff: 'The most information per screen and the most credible on a projector. The flattest — if you like the current softness, this will read austere.',
    numbers: 'radius 6px · spacing 3.8px · elevation hairline',
  },
  {
    id: 'b',
    name: 'B — Editorial',
    thesis: 'A warm paper canvas, 14px radius, real layered elevation, 10% more air, and the type scale a notch up.',
    tradeoff: 'Best for the narrative brief and long diligence text, and the most flattering when someone is reading rather than scanning. Costs roughly a fifth of the rows per screen.',
    numbers: 'radius 14px · spacing 4.4px · type +1 notch',
  },
  {
    id: 'c',
    name: 'C — Engineered',
    thesis: 'Near-monochrome with one accent, 4px radius, no shadow at all on resting surfaces — hairline rules divide instead — and the tightest spacing of the three.',
    tradeoff: 'Reads like an instrument, and colour can only ever mean status because nothing else is coloured. Densest on a phone. The furthest from today.',
    numbers: 'radius 4px · spacing 3.5px · elevation none',
  },
]

function tokensFor(id: string | null, theme: ThemeName) {
  return id === null ? readThemeTokens()[theme] : readDirectionTokens(id, theme)
}

/** The three ratios worth stating per direction, measured not claimed. */
function vitals(id: string | null, theme: ThemeName) {
  const t = tokensFor(id, theme)
  const safe = (a?: string, b?: string) => {
    if (!a || !b) return null
    try {
      return contrastOklch(a, b)
    } catch {
      return null
    }
  }
  return {
    body: safe(t['foreground'], t['card']),
    muted: safe(t['muted-foreground'], t['card']),
    separation: safe(t['card'], t['background']),
  }
}

export default function DirectionGallery({ only }: { only?: string }) {
  const shown = only ? DIRECTIONS.filter((d) => (d.id ?? 'current') === only) : DIRECTIONS

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Redraw directions</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          The same real record — Steelton, capture stage, 99% win probability, 181 documents, a PSA
          closing dated today — rendered under each candidate token set. Every colour, radius,
          shadow and gap below resolves through a CSS variable, so these are genuinely different
          palettes and not re-drawn mock-ups. Judge them on the phone too: the density differences
          are largest there.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Isolate:</span>
          {DIRECTIONS.map((d) => {
            const key = d.id ?? 'current'
            const active = only === key
            return (
              <Link
                key={key}
                href={active ? '/settings/ui' : `/settings/ui?direction=${key}`}
                className={`rounded-md px-2 py-1 ring-1 ring-inset transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground ring-primary'
                    : 'bg-card text-muted-foreground ring-border hover:text-foreground'
                }`}
              >
                {d.name}
              </Link>
            )
          })}
          {only && (
            <Link href="/settings/ui" className="text-primary hover:underline">
              show all four
            </Link>
          )}
        </div>
      </div>

      {shown.map((d) => {
        const light = vitals(d.id, 'light')
        const dark = vitals(d.id, 'dark')
        const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}:1`)
        return (
          <Panel key={d.id ?? 'current'} className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="text-base font-semibold">{d.name}</h3>
                <span className="text-xs text-muted-foreground tnum">{d.numbers}</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground max-w-prose">{d.thesis}</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-prose">
                <span className="label-caps">Trade-off</span> {d.tradeoff}
              </p>
              <p className="mt-2 text-xs text-muted-foreground tnum">
                body {fmt(light.body)} / {fmt(dark.body)} · muted {fmt(light.muted)} /{' '}
                {fmt(dark.muted)} · card-vs-canvas {fmt(light.separation)} / {fmt(dark.separation)}
                <span className="label-caps ml-2">light / dark</span>
              </p>
            </div>

            {/* The two themes of this direction, side by side. Theme class and
                direction attribute on the SAME element — see directions.css. */}
            <div className="grid gap-px bg-border xl:grid-cols-2">
              <div {...(d.id ? { 'data-direction': d.id } : {})}>
                <p className="label-caps text-muted-foreground px-4 pt-3 bg-background">Light</p>
                <DirectionPreview />
              </div>
              <div className="dark" {...(d.id ? { 'data-direction': d.id } : {})}>
                <p className="label-caps text-muted-foreground px-4 pt-3 bg-background">Dark</p>
                <DirectionPreview />
              </div>
            </div>
          </Panel>
        )
      })}
    </section>
  )
}
