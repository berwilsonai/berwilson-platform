/**
 * Page probes — the questions a screenshot cannot answer, asked the same way
 * every time so two sessions get the same number.
 *
 * Each value is a function BODY, evaluated in the page by `measure.mjs`. They
 * are plain strings rather than functions because they cross a CDP boundary as
 * source; keep them dependency-free and returning JSON-safe values.
 *
 * ⚠ EVERY PROBE REPORTS WHAT IT EXAMINED, NOT JUST WHAT IT FOUND. §12: an
 * empty population passes vacuously behind the same tick, and a script
 * reading a truncated set is worse than none because it is believed.
 */

/** Shared preamble: visible elements only, with their computed styles. */
const VISIBLE = `
  const all = [...document.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  })
`

/**
 * Ink the same colour as the fill behind it — the §3.1 bug, measured rather
 * than looked for. Walks up for the nearest non-transparent background, so it
 * catches a transparent element inheriting the fill it is unreadable on.
 */
const contrast = `
  ${VISIBLE}
  /*
    ⚠ THE COLOUR IS RESOLVED BY PAINTING IT, NOT BY PARSING IT. The first
    version pulled numbers out of the computed string with a regex, which this
    palette answers as \`oklab(0.74 0.0004 0.012 / 0.7)\` — so it read an
    OKLab lightness as a red channel and reported 25 false hits on perfectly
    legible muted text. A 1×1 canvas resolves any CSS colour, including the
    ones that do not exist yet.
  */
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const px = (c) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  }
  /*
    ⚠ AN ANCESTOR IS ONLY THE FILL IF THE TEXT IS ACTUALLY ON IT. The first
    version climbed the DOM and took the first opaque background, which found
    the 1px \`bg-critical\` "today" rule on /timeline as the fill for its own
    label — a label absolutely positioned 4px to the RIGHT of that rule, on the
    chart. Two themes, two false positives, and a false positive is how a check
    stops being read. So the ancestor has to CONTAIN the text's own box.
  */
  const overlaps = (inner, outer) =>
    outer.left <= inner.left + 1 && outer.right >= inner.right - 1 &&
    outer.top <= inner.top + 1 && outer.bottom >= inner.bottom - 1
  const behind = (el) => {
    const box = el.getBoundingClientRect()
    for (let n = el; n; n = n.parentElement) {
      const c = px(getComputedStyle(n).backgroundColor)
      if (c.a > 0.5 && (n === el || overlaps(box, n.getBoundingClientRect()))) return c
    }
    return px(getComputedStyle(document.body).backgroundColor)
  }
  const hits = []
  let examined = 0
  for (const el of all) {
    const text = (el.textContent ?? '').trim()
    // Only elements that render text OF THEIR OWN: a wrapper's textContent is
    // its children's, and flagging it would report one bug many times.
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own || !text) continue
    examined++
    const raw = px(getComputedStyle(el).color)
    const fill = behind(el)
    // Composite the ink over its fill — a 70%-alpha ink is 70% of the way to
    // the colour it sits on, which is exactly what the reader sees.
    const ink = {
      r: raw.r * raw.a + fill.r * (1 - raw.a),
      g: raw.g * raw.a + fill.g * (1 - raw.a),
      b: raw.b * raw.a + fill.b * (1 - raw.a),
    }
    const d = Math.abs(ink.r - fill.r) + Math.abs(ink.g - fill.g) + Math.abs(ink.b - fill.b)
    // 24 over three channels is well inside "no human reads this", and far
    // enough from a legitimate low-contrast caption to have no false hits.
    if (d < 24) {
      hits.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 40),
        delta: Math.round(d),
        ink: getComputedStyle(el).color,
        fill: \`rgb(\${Math.round(fill.r)} \${Math.round(fill.g)} \${Math.round(fill.b)})\`,
        cls: el.className?.toString?.().slice(0, 120) ?? '',
      })
    }
  }
  return { examined, invisible: hits.length, hits: hits.slice(0, 25) }
`

/**
 * The type scale as the page actually renders it (§4.1). Reports the size /
 * weight pairs in use with a count each, so "150 of 157 nodes at two sizes"
 * is a number rather than an impression.
 */
const type = `
  ${VISIBLE}
  const tally = new Map()
  let nodes = 0
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue
    nodes++
    const cs = getComputedStyle(el)
    const key = \`\${parseFloat(cs.fontSize)}px/\${cs.fontWeight}\`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  const sizes = new Set([...tally.keys()].map((k) => k.split('px')[0]))
  return {
    textNodes: nodes,
    distinctSizes: sizes.size,
    distinctRoles: tally.size,
    scale: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => \`\${k} ×\${n}\`),
  }
`

/**
 * Tap targets below the 44px floor (§4.6, and §12's density-token trap, where
 * 66 of them shrank to 38.7px because `h-11` is a `calc()` on the spacing
 * scale). Counts only controls a thumb can actually reach.
 */
const touch = `
  ${VISIBLE}
  const controls = all.filter((el) =>
    ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
    el.getAttribute('role') === 'button'
  )
  const small = controls
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => Math.min(r.width, r.height) < 44)
  return {
    controls: controls.length,
    below44: small.length,
    worst: small
      .sort((a, b) => Math.min(a.r.width, a.r.height) - Math.min(b.r.width, b.r.height))
      .slice(0, 15)
      .map(({ el, r }) => \`\${Math.round(r.width)}×\${Math.round(r.height)} \${el.tagName.toLowerCase()} "\${(el.textContent ?? '').trim().slice(0, 24)}"\`),
  }
`

/**
 * Vertical landmarks, for comparing a skeleton against the page it stands in
 * for (§3.3). Anything that moves between the two is layout shift the reader
 * watches happen.
 */
const landmarks = `
  ${VISIBLE}
  const main = document.querySelector('main') ?? document.body
  const top = main.getBoundingClientRect().top
  const marks = []
  for (const el of all) {
    const cs = getComputedStyle(el)
    const card = cs.borderTopWidth !== '0px' && parseFloat(cs.borderRadius) >= 6
    if (!card) continue
    const r = el.getBoundingClientRect()
    if (r.height < 60) continue
    marks.push({ y: Math.round(r.top - top), h: Math.round(r.height) })
  }
  return { cards: marks.slice(0, 12), scrollHeight: main.scrollHeight }
`

export const PROBES = { contrast, type, touch, landmarks }
