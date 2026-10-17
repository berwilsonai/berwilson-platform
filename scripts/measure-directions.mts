/**
 * Measure every candidate direction's palette, in both themes.
 *
 * The same contrast module the tests assert on, pointed at the scoped blocks in
 * src/app/directions.css rather than at :root. A direction that cannot clear
 * the thresholds is not a direction, it is a mood board.
 *
 * Run: node --import ./deploy/register.mjs scripts/measure-directions.mts
 */
import { contrastOklch } from '../src/lib/ui/contrast.ts'
import { readDirectionTokens } from '../src/lib/ui/tokens.ts'

const TONES = ['positive', 'caution', 'critical', 'info'] as const
const DIRECTIONS = [
  ['a', 'Institutional'],
  ['b', 'Editorial'],
  ['c', 'Engineered'],
] as const

let misses = 0
const safe = (a?: string, b?: string) => {
  if (!a || !b) return null
  try { return contrastOklch(a, b) } catch { return null }
}
const show = (v: number | null, min: number) => {
  if (v === null) return '    —'
  if (v < min) { misses++; return `${v.toFixed(2)}!`.padStart(6) }
  return v.toFixed(2).padStart(6)
}

for (const [id, name] of DIRECTIONS) {
  for (const theme of ['light', 'dark'] as const) {
    const t = readDirectionTokens(id, theme)
    console.log(`\n  ${id.toUpperCase()} ${name} — ${theme}`)
    console.log('    body/card fg          ', show(safe(t['foreground'], t['card']), 4.5))
    console.log('    muted-fg/card         ', show(safe(t['muted-foreground'], t['card']), 4.5))
    console.log('    primary-fg/primary    ', show(safe(t['primary-foreground'], t['primary']), 4.5))
    console.log('    card/canvas (separation)', show(safe(t['card'], t['background']), 1.01))
    console.log('    tone      ink/card ink/surf surf/canv edge/card')
    for (const tone of TONES) {
      console.log(
        `    ${tone.padEnd(9)} ${show(safe(t[tone], t['card']), 4.5)} ${show(safe(t[tone], t[`${tone}-surface`]), 4.5)}` +
        ` ${show(safe(t[`${tone}-surface`], t['background']), 1.01)} ${show(safe(t[`${tone}-edge`], t['card']), 1.2)}`
      )
    }
  }
}
console.log(misses === 0 ? '\n  ✓ all three directions clear every threshold\n' : `\n  ✗ ${misses} threshold miss(es), marked !\n`)
process.exitCode = misses === 0 ? 0 : 1
