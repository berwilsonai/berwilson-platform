/**
 * OKLCH → sRGB, and WCAG contrast. Pure, no dependency.
 *
 * ⚠ WHY THIS EXISTS. The palette in `globals.css` is written in OKLCH, which is
 * excellent for picking colours by eye and useless for knowing whether the
 * result is legible — a lightness of 0.52 means one thing at chroma 0.02 and
 * another at 0.19. So the status tones were MEASURED against the surfaces they
 * actually sit on rather than chosen to look right in one theme, and
 * `tone.test.ts` keeps them that way: a future palette edit that drops a tone
 * below its threshold fails the suite instead of shipping an unreadable chip in
 * the theme nobody checked.
 *
 * Both themes matter here. Dark mode is in daily use, and the `--chart-*` tokens
 * are the cautionary tale: identical values in `:root` and `.dark`, which is
 * only invisible because nothing renders them yet.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** oklch(L C H) with L in 0..1, C in 0..0.4ish, H in degrees. */
export function oklchToRgb(l: number, c: number, h: number): Rgb {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const bb = c * Math.sin(hRad)

  // OKLab → LMS
  const l_ = l + 0.3963377774 * a + 0.2158037573 * bb
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bb
  const s_ = l - 0.0894841775 * a - 1.291485548 * bb

  const lC = l_ * l_ * l_
  const mC = m_ * m_ * m_
  const sC = s_ * s_ * s_

  // LMS → linear sRGB
  const lr = 4.0767416621 * lC - 3.3077115913 * mC + 0.2309699292 * sC
  const lg = -1.2684380046 * lC + 2.6097574011 * mC - 0.3413193965 * sC
  const lb = -0.0041960863 * lC - 0.7034186147 * mC + 1.707614701 * sC

  const gamma = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.min(1, Math.max(0, v))
  }

  return { r: gamma(lr), g: gamma(lg), b: gamma(lb) }
}

/** Parse the `oklch(L C H)` / `oklch(L C H / A)` form used in globals.css. */
export function parseOklch(value: string): { l: number; c: number; h: number } | null {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (!m) return null
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2.1 contrast ratio, 1..21. Order of arguments does not matter. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Contrast between two `oklch(...)` strings. Throws on anything unparseable. */
export function contrastOklch(fg: string, bg: string): number {
  const f = parseOklch(fg)
  const b = parseOklch(bg)
  if (!f || !b) throw new Error(`Not an oklch() colour: ${!f ? fg : bg}`)
  return contrast(oklchToRgb(f.l, f.c, f.h), oklchToRgb(b.l, b.c, b.h))
}

/**
 * Perceptual lightness difference between two OKLCH colours, 0..1.
 *
 * ⚠ USE THIS, NOT `contrast()`, FOR SURFACE-vs-SURFACE SEPARATION. WCAG
 * contrast is a ratio with a `+0.05` floor, which swamps any real difference
 * at near-black: the dark sidebar at L 0.155 measured 1.03:1 against the
 * canvas, and dropping it all the way to L 0.085 still measured 1.031:1 — the
 * metric simply cannot see a change a human sees immediately. OKLCH lightness
 * is perceptually uniform by construction, so a delta in it means the same
 * thing at the top and the bottom of the range.
 *
 * Contrast is still the right tool for TEXT on a background, which is what it
 * was designed for.
 */
export function lightnessDelta(a: string, b: string): number {
  const pa = parseOklch(a)
  const pb = parseOklch(b)
  if (!pa || !pb) throw new Error(`Not an oklch() colour: ${!pa ? a : b}`)
  return Math.abs(pa.l - pb.l)
}
