// Builds src/lib/map/gazetteer.json — the offline US place/ZIP centroid
// dataset behind "Place from location" on /map (src/lib/map/geocode.ts).
//
// Source: US Census Bureau 2024 Gazetteer files (public domain).
// Regenerate only if the Census publishes a new vintage (annual; changes are
// negligible for our purpose — city centers don't move):
//
//   node scripts/build-gazetteer.mjs [places.txt zcta.txt]
//
// With no args it downloads + unzips the files into a temp dir (needs curl +
// unzip on PATH). Output is committed — the app never fetches anything.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CENSUS_BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer'
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/lib/map/gazetteer.json'
)

function fetchFiles() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gazetteer-'))
  for (const name of ['2024_Gaz_place_national', '2024_Gaz_zcta_national']) {
    execSync(`curl -sL -o ${name}.zip "${CENSUS_BASE}/${name}.zip" && unzip -o -q ${name}.zip`, {
      cwd: dir,
      stdio: 'inherit',
    })
  }
  return [
    path.join(dir, '2024_Gaz_place_national.txt'),
    path.join(dir, '2024_Gaz_zcta_national.txt'),
  ]
}

const [placesPath, zctaPath] = process.argv[2] ? process.argv.slice(2, 4) : fetchFiles()
if (!existsSync(placesPath) || !existsSync(zctaPath)) {
  console.error('usage: node scripts/build-gazetteer.mjs [places.txt zcta.txt]')
  process.exit(1)
}

const round = (s) => Math.round(parseFloat(s) * 1e4) / 1e4

// Census NAME carries a legal/statistical suffix ("Sandy city", "Magna CDP",
// "Louisville/Jefferson County metro government (balance)") — strip it so
// keys match how people write locations.
const LSAD_SUFFIX =
  /\s+(city(?: and borough)?|town|village|borough|municipality|(?:metro )?township|corporation|CDP|comunidad|zona urbana|urbana|consolidated government(?: \(balance\))?|unified government(?: \(balance\))?|metro(?:politan)? government(?: \(balance\))?|urban county|\(balance\))$/i

const normalizeName = (name) =>
  name.replace(LSAD_SUFFIX, '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()

// places: "st|name" -> [lat, lng, land_km2]  (area disambiguates duplicates)
const places = {}
const placeRows = readFileSync(placesPath, 'utf8').split('\n').slice(1)
for (const row of placeRows) {
  const cols = row.split('\t')
  if (cols.length < 12) continue
  const [usps, , , name, , , aland] = cols
  const lat = round(cols[10])
  const lng = round(cols[11])
  if (!usps || !name || Number.isNaN(lat) || Number.isNaN(lng)) continue
  const km2 = Math.round(Number(aland) / 1e6)
  const key = `${usps.toLowerCase()}|${normalizeName(name)}`
  if (!places[key] || places[key][2] < km2) places[key] = [lat, lng, km2]
}

// zips: "84095" -> [lat, lng]
const zips = {}
const zctaRows = readFileSync(zctaPath, 'utf8').split('\n').slice(1)
for (const row of zctaRows) {
  const cols = row.split('\t')
  if (cols.length < 7) continue
  const lat = round(cols[5])
  const lng = round(cols[6])
  if (!/^\d{5}$/.test(cols[0]) || Number.isNaN(lat) || Number.isNaN(lng)) continue
  zips[cols[0]] = [lat, lng]
}

// states: "ut" -> [lat, lng] — land-area-weighted mean of the state's places,
// which biases toward where things actually are. Coarse by design; a
// state-only match is a drag-to-refine starting point.
const acc = {}
for (const [key, [lat, lng, km2]] of Object.entries(places)) {
  const st = key.slice(0, 2)
  const w = Math.max(km2, 1)
  const a = (acc[st] ??= [0, 0, 0])
  a[0] += lat * w
  a[1] += lng * w
  a[2] += w
}
const states = {}
for (const [st, [latSum, lngSum, w]] of Object.entries(acc)) {
  states[st] = [Math.round((latSum / w) * 1e4) / 1e4, Math.round((lngSum / w) * 1e4) / 1e4]
}

writeFileSync(OUT, JSON.stringify({ places, zips, states }))
console.log(
  `wrote ${OUT}: ${Object.keys(places).length} places, ${Object.keys(zips).length} zips, ${Object.keys(states).length} states`
)
