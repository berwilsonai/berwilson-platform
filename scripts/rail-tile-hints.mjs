#!/usr/bin/env node
/**
 * GeoJSONSeq in, GeoJSONSeq out: normalise the NARN attributes into the small
 * set of tile properties /map reads, and tell tippecanoe which zoom each line
 * first appears at.
 *
 * Why the per-feature minzoom rather than tippecanoe's --drop-densest-as-
 * needed: dropping is density-driven and blind to what a line IS, so a
 * STRACNET main line through a busy terminal district gets dropped at national
 * zoom while a yard lead beside it survives. The whole point of the layer is
 * that the strategic network is complete at every zoom — so STRACNET is
 * admitted at z2 and the yard tracks wait until you are close enough to care.
 *
 * Reads stdin, writes stdout. Prints a breakdown to stderr so the build says
 * what it kept and, more usefully, what it dropped and why.
 */
import { createInterface } from 'node:readline'

// One feature's first zoom. Rail is context under the portfolio, and context
// that arrives all at once at z2 is a grey smear over the whole continent.
const MINZOOM_STRACNET = 2 // the strategic network: always on
const MINZOOM_MAINLINE = 4 // main sub-network: the Class I map, continental and closer
const MINZOOM_OTHER = 9 // sidings, industrial leads, yard tracks
const MINZOOM_INACTIVE = 10 // out of service, abandoned, removed, rail-trail

// NARN `net` codes meaning the track no longer carries traffic. Kept rather
// than dropped: a rail-banked or abandoned right-of-way is a reason to look at
// a site, not a reason to hide it — it is just not a route.
const INACTIVE_NET = new Set(['X', 'A', 'R', 'T'])

// The `stracnet` domain: 'S' a designated strategic corridor, 'C' a connector
// line reaching an installation or port. NOT 'Y'/'N' — a yes/no filter here
// builds an empty layer and nothing reports it.
const STRACNET_CLASSES = new Set(['S', 'C'])

const counts = new Map()
const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1)

// NARN's own "not recorded" markers, measured against the corpus rather than
// assumed: BRANCH carries the literal `#N\A` 42,448 times, and RROWNER1 uses
// XXXX (unknown, 5,380 miles) and PVTX (private) where there is no reporting
// mark. Each would otherwise print at a reader as if it were a railroad's
// name — §7's rule about never showing a stored code raw, one layer earlier.
const NULL_MARKERS = new Set(['-', 'NA', 'N/A', '#N/A', '#N\\A', 'NULL', 'NONE', 'XXXX', 'PVTX'])

function clean(v) {
  if (v == null) return undefined
  const s = String(v).trim()
  if (!s || NULL_MARKERS.has(s.toUpperCase())) return undefined
  return s
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
const out = []

for await (const line of rl) {
  if (!line.trim()) continue
  let f
  try {
    f = JSON.parse(line)
  } catch {
    bump('unparseable')
    continue
  }
  if (!f.geometry || !f.geometry.coordinates?.length) {
    bump('no geometry')
    continue
  }
  const p = f.properties ?? {}
  const net = clean(p.NET)?.toUpperCase()
  const stracRaw = clean(p.STRACNET)?.toUpperCase()
  const strac = stracRaw && STRACNET_CLASSES.has(stracRaw) ? stracRaw : undefined
  if (stracRaw && !strac) bump(`unknown STRACNET code "${stracRaw}"`)
  const inactive = net != null && INACTIVE_NET.has(net)

  const minzoom = strac
    ? MINZOOM_STRACNET
    : inactive
      ? MINZOOM_INACTIVE
      : net === 'M'
        ? MINZOOM_MAINLINE
        : MINZOOM_OTHER
  bump(
    strac === 'S'
      ? 'STRACNET (z2)'
      : strac === 'C'
        ? 'defense connector (z2)'
        : inactive
          ? `not in service — ${net} (z10)`
          : net === 'M'
            ? 'main sub network (z4)'
            : 'other track (z9)'
  )

  // Only what the popup and the styling read — every extra property is paid
  // for once per feature in every tile the feature appears in.
  const props = {
    id: num(p.FRAARCID),
    owner: clean(p.RROWNER1),
    rights: clean(p.TRKRGHTS1),
    subdiv: clean(p.SUBDIV),
    branch: clean(p.BRANCH),
    net,
    passenger: clean(p.PASSNGR),
    tracks: num(p.TRACKS),
    miles: num(p.MILES) != null ? Math.round(num(p.MILES) * 100) / 100 : undefined,
    state: clean(p.STATEAB),
  }
  // `strac` is written only when the line carries a designation: the style
  // filters on its presence, and a null on 280k undesignated features is bytes
  // in every tile saying nothing.
  if (strac) props.strac = strac
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k]

  out.push(
    JSON.stringify({
      type: 'Feature',
      properties: props,
      geometry: f.geometry,
      tippecanoe: { minzoom },
    })
  )
  if (out.length >= 2000) {
    process.stdout.write(out.join('\n') + '\n')
    out.length = 0
  }
}
if (out.length) process.stdout.write(out.join('\n') + '\n')

const total = [...counts.values()].reduce((a, b) => a + b, 0)
process.stderr.write(`  ${total.toLocaleString('en-US')} features\n`)
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) {
  process.stderr.write(`    ${v.toLocaleString('en-US').padStart(9)}  ${k}\n`)
}
