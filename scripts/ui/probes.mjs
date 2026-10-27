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

/**
 * ⚠ EVERY BACKSLASH IN A REGEX HERE MUST BE DOUBLED, AND NO COMMENT MAY
 * CONTAIN A BACKTICK.
 *
 * These probes are TEMPLATE LITERALS, and `\\d` inside one is not an escape
 * JavaScript recognises — it collapses to a bare `d`. So `/\\d/` written with
 * one backslash reaches the page as `/d/`, a regex that matches the LETTER d.
 * It cost a round-trip the first time: the numerals probe reported "Today",
 * "On Hold" and "West Wendover" as figures, because all three contain a d.
 *
 * The tell was the EXAMINED count, not the hits — 3 figures on a page full of
 * them, then 717 on a page with a few hundred. That is the whole reason every
 * probe reports what it looked at.
 *
 * The backtick is the louder trap and the cheaper one: a stray one inside a
 * probe's own comment ends the literal and the FILE stops parsing, so it is
 * caught on the next run rather than quietly measuring the wrong thing.
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
 * scale).
 *
 * ⚠ RUN IT AT A PHONE WIDTH OR THE ANSWER IS MEANINGLESS:
 *     BW_SHOOT_SIZE=390,844 node scripts/ui/measure.mjs --probe=touch /tasks
 * The house idiom is h-[2.75rem] sm:h-7 — 44px on a phone, 28px on a desktop
 * where the pointer is a mouse. Measured at 1512px that reads as 298 of 436
 * controls "below the floor", every one of them correctly sized for the
 * device it is actually on. The probe reports the viewport it measured so the
 * number can never be read without it.
 *
 * ⚠ AND AN INLINE LINK IS NOT A TAP TARGET. A deal name inside a sentence is
 * 203×18 by definition; counting it buried the real hits 100 to 1 on
 * /commitments, so links shorter than 24px that sit in flowing text are out.
 */
const touch = `
  ${VISIBLE}
  // A link under 24px tall is a TEXT link — a deal name in a meta row, a
  // breadcrumb — not a tap target, and counting them buried the real hits 100
  // to 1 on /commitments. The sibling test tried first was wrong: those links
  // sit among sibling SPANS, not among text nodes.
  const inlineLink = (el) =>
    el.tagName.toLowerCase() === 'a' && el.getBoundingClientRect().height < 24
  const controls = all.filter((el) =>
    (['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
      el.getAttribute('role') === 'button') && !inlineLink(el)
  )
  /*
    ⚠ THE CONTROL'S OWN BOX IS NOT ITS HIT AREA. The house idiom for a small
    control is an invisible overlay — a 14px checkbox inside a label carrying
    a 44px \`tap-target\` — because padding would shift the row under the next
    tap (§12, 08-27). Measuring the input alone reported every one of those as
    14×14: 279 false positives on /decide, and a probe nobody would read
    twice.

    ⚠ AND THE OBVIOUS FIX — \`elementFromPoint\` at the centre ±21px — IS ALSO
    WRONG HERE, for a reason that took a round to see: it only answers for
    coordinates inside the VIEWPORT, and on a 448-control page most controls
    are below the fold. It returned null for all four points on every one of
    them, which the test read as "does not reach" and reported as the same
    279. A probe that is broken and a page that is broken produce the same
    number; the tell was that the number did not move when the bug was fixed.

    So the target is GEOMETRIC: the union of the control, the label that wraps
    it, and any absolutely-positioned overlay inside that label. No viewport,
    no scrolling, same answer for every control on the page.
  */
  const union = (a, b) => !b ? a : {
    width: Math.max(a.left + a.width, b.left + b.width) - Math.min(a.left, b.left),
    height: Math.max(a.top + a.height, b.top + b.height) - Math.min(a.top, b.top),
  }
  const effective = (el) => {
    let box = el.getBoundingClientRect()
    const host = el.closest('label') ?? el.parentElement
    if (!host) return box
    if (host !== el && host.contains(el) && host.children.length <= 3) {
      box = union(box, host.getBoundingClientRect())
    }
    for (const ov of host.querySelectorAll('[aria-hidden]')) {
      if (getComputedStyle(ov).position === 'absolute') box = union(box, ov.getBoundingClientRect())
    }
    return box
  }
  const small = controls
    .map((el) => ({ el, r: el.getBoundingClientRect(), hit: effective(el) }))
    .filter(({ hit }) => Math.min(hit.width, hit.height) < 44)
  return {
    viewport: window.innerWidth + '×' + window.innerHeight,
    controls: controls.length,
    below44: small.length,
    worst: small
      .sort((a, b) => Math.min(a.hit.width, a.hit.height) - Math.min(b.hit.width, b.hit.height))
      .slice(0, 15)
      .map(({ el, r, hit }) => \`\${Math.round(hit.width)}×\${Math.round(hit.height)} tap (box \${Math.round(r.width)}×\${Math.round(r.height)}) \${el.tagName.toLowerCase()} "\${(el.textContent ?? '').trim().slice(0, 24)}"\`),
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

/**
 * Numerals that are not tabular (§4.4). A proportional `1` is narrower than a
 * `0`, so a column of figures is visibly ragged and two rows cannot be
 * compared by eye — which is the only reason to put them in a column.
 *
 * Counts only elements whose OWN text is mostly digits, so prose with a year
 * in it is not swept in.
 */
const numerals = `
  ${VISIBLE}
  const hits = []
  let figures = 0
  for (const el of all) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    if (!own) continue
    /*
      What counts as a figure. ⚠ THE FIRST RULE WAS "40% OF THE CHARACTERS ARE
      DIGITS" AND IT FOUND THREE THINGS ON A WHOLE PAGE — it threw out "4d
      ago", "19d overdue" and "87/100", which are precisely the ragged short
      figures a column is meant to align. A figure is a SHORT run of words
      containing a digit; a sentence that mentions a year is not.
    */
    const digits = (own.match(/\\d/g) ?? []).length
    if (digits === 0 || own.length > 28 || own.split(/\\s+/).length > 4) continue
    figures++
    const cs = getComputedStyle(el)
    const tabular = /tabular-nums/.test(cs.fontVariantNumeric) ||
      /tnum/.test(cs.fontFeatureSettings ?? '')
    if (!tabular) {
      hits.push({
        text: own.slice(0, 24),
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString?.().slice(0, 90) ?? '',
      })
    }
  }
  return { figures, proportional: hits.length, hits: hits.slice(0, 20) }
`

/**
 * Interactive elements with no focus style of their own (§4.5).
 *
 * ⚠ THE OBVIOUS IMPLEMENTATION IS THE BROKEN ONE. The first version focused
 * each control and diffed its computed style. It reported 436 of 436 controls
 * on /decide as having no ring — a perfect score in the wrong direction,
 * because `el.focus()` does NOT satisfy `:focus-visible`. That pseudo-class
 * exists precisely to tell a keyboard focus from a programmatic or mouse one,
 * so an app that correctly uses `focus-visible:` everywhere measures as having
 * nothing, and an app that wrongly uses `focus:` would have measured as fine.
 * The probe would have inverted its own answer.
 *
 * So this reads the STYLESHEETS instead: strip the pseudo-class off every rule
 * that carries one and ask whether the element matches what is left. That is
 * what the browser will do when the key is actually pressed.
 */
const focus = `
  ${VISIBLE}
  // Every selector in the document that styles a focus state, with the
  // pseudo-class removed so it can be matched against an element at rest.
  const selectors = []
  let universal = false
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }  // a cross-origin sheet
    /*
      ⚠ READ THE SELECTOR FIRST, THEN RECURSE — NEVER "RECURSE IF IT HAS
      CHILDREN". Chrome supports nested CSS, so EVERY CSSStyleRule now
      carries a (usually empty) cssRules list. A walk that branched on
      "if (rule.cssRules)" therefore skipped every style rule in the document
      and found 0 focus selectors on a page with 436 controls — which then
      reported all 436 as unstyled. A probe that says "everything is broken"
      is almost always broken itself.
    */
    const walk = (list) => {
      for (const rule of list) {
        const sel = rule.selectorText
        if (sel && sel.includes(':focus')) {
          for (const one of sel.split(',')) {
            const bare = one.replace(/:focus-visible|:focus-within|:focus/g, '').trim()
            // A bare \`:focus-visible { … }\` strips to nothing — that is the
            // house FLOOR in globals.css, which applies to everything. Record
            // it apart, or the probe reports a page as unstyled while every
            // control on it draws a ring.
            if (bare) selectors.push(bare)
            else universal = true
          }
        }
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules)
      }
    }
    walk(rules)
  }

  const controls = all.filter((el) =>
    ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
    el.getAttribute('role') === 'button' || el.tabIndex >= 0
  )
  const naked = []
  for (const el of controls) {
    const styled = selectors.some((sel) => {
      try { return el.matches(sel) || el.closest(sel) !== null } catch { return false }
    })
    if (styled) continue
    naked.push({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 28) || el.getAttribute('aria-label') || '',
      cls: el.className?.toString?.().slice(0, 90) ?? '',
    })
  }
  return {
    focusSelectors: selectors.length,
    // The floor in globals.css. With it, nothing is unreachable by keyboard;
    // without it, \`ownStyle\` below is the count of controls that draw nothing.
    houseFloor: universal,
    controls: controls.length,
    noOwnStyle: naked.length,
    unreachable: universal ? 0 : naked.length,
    hits: naked.slice(0, 20),
  }
`

export const PROBES = { contrast, type, touch, landmarks, numerals, focus }
