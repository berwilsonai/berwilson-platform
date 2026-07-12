// Offline location → coordinates lookup for /map placement. Resolves the
// free-text `projects.location` field against a bundled US Census gazetteer
// (city/ZIP/state centroids — see scripts/build-gazetteer.mjs) plus a small
// hand-kept list for international portfolio locations. Deliberately
// NOT street-level geocoding: no external calls ever leave the box, and the
// map presents at portfolio zoom where a city centroid reads as exact.
// Server-side only — the dataset is ~2MB; keep it out of client bundles.

import gazetteer from './gazetteer.json'

const { places, zips, states } = gazetteer as unknown as {
  places: Record<string, [number, number, number]> // "st|name" -> [lat, lng, land_km2]
  zips: Record<string, [number, number]>
  states: Record<string, [number, number]>
}

export type GeocodePrecision = 'zip' | 'city' | 'state'

export interface GeocodeResult {
  latitude: number
  longitude: number
  /** Human-readable form of what actually matched, e.g. "South Jordan, UT". */
  matched: string
  precision: GeocodePrecision
}

const STATE_NAMES: Record<string, string> = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga',
  hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia',
  kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md',
  massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms',
  missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok',
  oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt',
  virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi',
  wyoming: 'wy', 'district of columbia': 'dc', 'washington dc': 'dc',
  'puerto rico': 'pr',
}
const STATE_ABBRS = new Set(Object.values(STATE_NAMES))

// International places the portfolio actually touches — the US gazetteer can't
// resolve these. Keyed by normalized name; capital cities get 'city' precision,
// bare country names get 'state' (approximate → bulk auto-place skips them,
// single auto-place warns to Reposition). Adding a country later: add rows here
// AND a box in scripts/map-regions-full.geojson, then re-extract the basemap.
const INTERNATIONAL: Record<string, [number, number, string, GeocodePrecision]> = {
  tonga: [-21.14, -175.2, 'Tonga', 'state'],
  "nuku'alofa": [-21.14, -175.2, "Nuku'alofa, Tonga", 'city'],
  nukualofa: [-21.14, -175.2, "Nuku'alofa, Tonga", 'city'],
  albania: [41.15, 20.17, 'Albania', 'state'],
  tirana: [41.33, 19.82, 'Tirana, Albania', 'city'],
}

const norm = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()

/** "st|salt lake city" → "Salt Lake City, ST" for the matched label. */
function label(key: string): string {
  const [st, name] = key.split('|')
  const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase())
  return `${pretty}, ${st.toUpperCase()}`
}

function lookupCity(state: string, city: string): string | null {
  const key = `${state}|${city}`
  if (places[key]) return key
  // People write "Saint George"; the Census writes "St. George".
  if (city.startsWith('saint ')) {
    const alt = `${state}|st ${city.slice(6)}`
    if (places[alt]) return alt
  }
  return null
}

/** City with no state given: unique match wins; ties prefer UT, then largest. */
function lookupCityAnyState(city: string): string | null {
  const suffix = `|${city}`
  const hits: string[] = []
  for (const key in places) {
    if (key.endsWith(suffix)) hits.push(key)
  }
  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0]
  const ut = hits.find((k) => k.startsWith('ut|'))
  if (ut) return ut
  return hits.reduce((a, b) => (places[a][2] >= places[b][2] ? a : b))
}

/** Match segments against the international list; city precision beats country. */
function lookupInternational(candidates: string[]): GeocodeResult | null {
  let approx: GeocodeResult | null = null
  for (const cand of candidates) {
    // Normalize typographic apostrophes/okina ("Nukuʻalofa") to a plain one.
    const hit = INTERNATIONAL[cand.replace(/[ʻ‘’`]/g, "'")]
    if (!hit) continue
    const result: GeocodeResult = { latitude: hit[0], longitude: hit[1], matched: hit[2], precision: hit[3] }
    if (result.precision === 'city') return result
    approx ??= result
  }
  return approx
}

/** Segment ends with a state? Returns [state, remainder-before-it] or null. */
function splitTrailingState(segment: string): [string, string] | null {
  const words = segment.split(' ')
  // Two-word state names first ("new york", "salt lake city utah" is 1-word)
  for (const take of [3, 2, 1]) {
    if (words.length < take) continue
    const tail = words.slice(-take).join(' ')
    const abbr = STATE_NAMES[tail] ?? (take === 1 && STATE_ABBRS.has(tail) ? tail : null)
    if (abbr) return [abbr, words.slice(0, -take).join(' ').trim()]
  }
  return null
}

export function geocodeLocation(text: string): GeocodeResult | null {
  const raw = text.trim()
  if (!raw) return null

  // 1) ZIP wins — it's the most specific thing people include. Last match,
  //    and only if it's a real ZCTA (street numbers are 5 digits too).
  const zipMatches = raw.match(/\b\d{5}\b/g)
  if (zipMatches) {
    for (let i = zipMatches.length - 1; i >= 0; i--) {
      const hit = zips[zipMatches[i]]
      if (hit) {
        return { latitude: hit[0], longitude: hit[1], matched: `ZIP ${zipMatches[i]}`, precision: 'zip' }
      }
    }
  }

  // 2) Comma segments, scanned from the end for a state; the segment before
  //    it (or the words before it in the same segment) is the city. Handles
  //    "123 Main St, South Jordan, UT 84095" and "South Jordan Utah" alike.
  const segments = norm(raw.replace(/\b\d{5}(?:-\d{4})?\b/g, ''))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'usa' && s !== 'united states' && s !== 'us')

  // International portfolio locations (Tonga, Albania, …) — checked before the
  // US state scan; the whole string covers the no-comma case ("Tonga").
  const intl = lookupInternational([...segments, norm(raw)])
  if (intl) return intl

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    const split = splitTrailingState(seg)
    if (!split) continue
    const [state, before] = split
    const cityCandidates = [before, segments[i - 1] ?? ''].filter(Boolean)
    for (const city of cityCandidates) {
      const key = lookupCity(state, city)
      if (key) {
        const [lat, lng] = places[key]
        return { latitude: lat, longitude: lng, matched: label(key), precision: 'city' }
      }
    }
    const st = states[state]
    if (st) {
      return { latitude: st[0], longitude: st[1], matched: state.toUpperCase(), precision: 'state' }
    }
  }

  // 3) No state anywhere — try each segment as a bare city name, then the
  //    whole string ("Herriman" or "Cedar City").
  const candidates = [...segments].reverse()
  const whole = norm(raw)
  if (!candidates.includes(whole)) candidates.push(whole)
  for (const city of candidates) {
    const key = lookupCityAnyState(city)
    if (key) {
      const [lat, lng] = places[key]
      return { latitude: lat, longitude: lng, matched: label(key), precision: 'city' }
    }
  }

  return null
}
