/**
 * Utah AGRC parcel lookup — the public cadastre, queried by the same parcel
 * numbers a county exhibit prints.
 *
 * WHY THIS EXISTS. The Delta rezone exhibit carries a disclaimer naming its own
 * source: "publicly available Millard County / Utah AGRC parcel geometry". So
 * the footprint on that sheet does not have to be traced off a photograph — it
 * can be fetched, by ID, from the layer it was drawn from. Every Utah county
 * publishes an LIR (Land Information Record) layer with a standard schema, so
 * one client covers all 29.
 *
 * WHAT LEAVES THE MACHINE. A parcel number and a county name, to a public
 * state GIS endpoint. No platform data, no project names, no correspondence —
 * the same posture as the Gemini web-research path (CLAUDE.md §2): the query
 * goes out, nothing about the deal does. This is import-time only; no runtime
 * surface depends on the network being up.
 *
 * ACREAGE IS RETURNED, NEVER RECONCILED. The county's figure and the deal's
 * figure are stored in two columns and left to disagree — see the migration.
 */

/** County → LIR service name. All 29; the service slug drops spaces. */
export const UTAH_COUNTY_SERVICES: Record<string, string> = {
  Beaver: 'Parcels_Beaver_LIR',
  'Box Elder': 'Parcels_BoxElder_LIR',
  Cache: 'Parcels_Cache_LIR',
  Carbon: 'Parcels_Carbon_LIR',
  Daggett: 'Parcels_Daggett_LIR',
  Davis: 'Parcels_Davis_LIR',
  Duchesne: 'Parcels_Duchesne_LIR',
  Emery: 'Parcels_Emery_LIR',
  Garfield: 'Parcels_Garfield_LIR',
  Grand: 'Parcels_Grand_LIR',
  Iron: 'Parcels_Iron_LIR',
  Juab: 'Parcels_Juab_LIR',
  Kane: 'Parcels_Kane_LIR',
  Millard: 'Parcels_Millard_LIR',
  Morgan: 'Parcels_Morgan_LIR',
  Piute: 'Parcels_Piute_LIR',
  Rich: 'Parcels_Rich_LIR',
  'Salt Lake': 'Parcels_SaltLake_LIR',
  'San Juan': 'Parcels_SanJuan_LIR',
  Sanpete: 'Parcels_Sanpete_LIR',
  Sevier: 'Parcels_Sevier_LIR',
  Summit: 'Parcels_Summit_LIR',
  Tooele: 'Parcels_Tooele_LIR',
  Uintah: 'Parcels_Uintah_LIR',
  Utah: 'Parcels_Utah_LIR',
  Wasatch: 'Parcels_Wasatch_LIR',
  Washington: 'Parcels_Washington_LIR',
  Wayne: 'Parcels_Wayne_LIR',
  Weber: 'Parcels_Weber_LIR',
}

export const UTAH_COUNTIES = Object.keys(UTAH_COUNTY_SERVICES)

const AGRC_ROOT =
  'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services'

/** URL length is the real constraint on an IN list; 40 ids is comfortably under it. */
const ID_BATCH = 40
const REQUEST_TIMEOUT_MS = 45_000

export type PolygonGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }

export interface AgrcParcel {
  parcelId: string
  /** The county assessor's acreage. Never merged with the deal's own figure. */
  acres: number | null
  ownerLabel: string | null
  propertyClass: string | null
  geometry: PolygonGeometry
  centroid: { lat: number; lng: number }
  /** The county's "current as of" date for this record. */
  asOf: string | null
}

export interface AgrcLookupResult {
  found: AgrcParcel[]
  /**
   * Ids the county layer has no row for. Named separately and never folded into
   * a count, because "we looked and it is not there" and "we never looked" are
   * different answers (CLAUDE.md §12) — a missing parcel usually means it was
   * split or merged since the exhibit was drawn, which is worth knowing.
   */
  missing: string[]
}

/** ArcGIS `where` is SQL — a parcel id is human-entered and must be escaped. */
function quote(id: string): string {
  return `'${id.replace(/'/g, "''")}'`
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface EsriFeature {
  properties?: Record<string, unknown>
  geometry?: {
    type?: string
    coordinates?: unknown
  } | null
}

/**
 * Signed area of a ring, in squared degrees. Only ever compared against other
 * rings of the same parcel, so no projection is needed — and the sign is what
 * distinguishes an outer ring from a hole.
 */
function ringArea(ring: [number, number][]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    // Positive for counter-clockwise, matching the cross-product convention
    // the centroid sum below uses. ⚠ The trapezoid form with (y_j - y_i) is
    // the SAME area with the OPPOSITE sign, and pairing it with that centroid
    // sum negates both coordinates — which is a parcel in Utah reported in the
    // southern hemisphere, off the coast of Western Australia. Caught only by
    // reading the imported rows back; nothing else complains, because the
    // geometry itself is stored raw and draws perfectly.
    sum += (ring[j][0] + ring[i][0]) * (ring[i][1] - ring[j][1])
  }
  return sum / 2
}

/**
 * Centroid of the largest outer ring. Exact for the section-and-quarter
 * rectangles most Utah farm parcels are, and it stays INSIDE the shape, which
 * the centroid of a multi-part parcel split by a highway would not.
 */
function centroidOf(geometry: PolygonGeometry): { lat: number; lng: number } {
  const rings: [number, number][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((poly) => poly[0])

  let best: [number, number][] = rings[0]
  let bestArea = 0
  for (const ring of rings) {
    const area = Math.abs(ringArea(ring))
    if (area > bestArea) {
      bestArea = area
      best = ring
    }
  }

  // Degenerate ring (a sliver, or a record with three coincident points):
  // fall back to the bounding-box centre rather than dividing by zero.
  const area = ringArea(best)
  if (!area) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [x, y] of best) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 }
  }

  let cx = 0
  let cy = 0
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1]
    cx += (best[j][0] + best[i][0]) * f
    cy += (best[j][1] + best[i][1]) * f
  }
  return { lng: cx / (6 * area), lat: cy / (6 * area) }
}

/** Bounding box of a set of parcels, as MapLibre wants it: [W, S, E, N]. */
export function parcelBounds(
  geometries: PolygonGeometry[]
): [number, number, number, number] | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const g of geometries) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
}

function asOfDate(value: unknown): string | null {
  // The LIR layer returns CURRENT_ASOF as epoch millis, not a string.
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value).toISOString().slice(0, 10)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Look up parcels by county and id.
 *
 * A county layer stores a parcel split by a road or canal as SEVERAL rows
 * sharing one PARCEL_ID. Those are dissolved into a single MultiPolygon here,
 * because they are one piece of property to everyone who talks about the deal —
 * counting them as separate parcels would inflate the schedule.
 */
export async function lookupParcels(
  county: string,
  parcelIds: string[]
): Promise<AgrcLookupResult> {
  const service = UTAH_COUNTY_SERVICES[county]
  if (!service) throw new Error(`No Utah AGRC parcel layer for county "${county}"`)

  const wanted = [...new Set(parcelIds.map((id) => id.trim()).filter(Boolean))]
  if (wanted.length === 0) return { found: [], missing: [] }

  // parcelId → the rings gathered so far across however many rows carry it.
  const parts = new Map<
    string,
    { polys: [number, number][][][]; props: Record<string, unknown> }
  >()

  for (const batch of chunk(wanted, ID_BATCH)) {
    const params = new URLSearchParams({
      where: `PARCEL_ID IN (${batch.map(quote).join(',')})`,
      outFields: 'PARCEL_ID,PARCEL_ACRES,PROP_CLASS,SUBDIV_NAME,CURRENT_ASOF',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'geojson',
    })

    const res = await fetch(`${AGRC_ROOT}/${service}/FeatureServer/0/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`Utah AGRC ${service} returned ${res.status}`)
    }
    const body = (await res.json()) as {
      features?: EsriFeature[]
      error?: { message?: string }
    }
    // ArcGIS answers 200 with an error body — checking res.ok alone would read
    // an error as an empty result and report every parcel as missing.
    if (body.error) {
      throw new Error(`Utah AGRC ${service}: ${body.error.message ?? 'query failed'}`)
    }

    for (const feature of body.features ?? []) {
      const props = feature.properties ?? {}
      const id = asString(props.PARCEL_ID)
      const geom = feature.geometry
      if (!id || !geom?.coordinates) continue

      const polys: [number, number][][][] =
        geom.type === 'MultiPolygon'
          ? (geom.coordinates as [number, number][][][])
          : [geom.coordinates as [number, number][][]]

      const existing = parts.get(id)
      if (existing) existing.polys.push(...polys)
      else parts.set(id, { polys, props })
    }
  }

  const found: AgrcParcel[] = []
  for (const id of wanted) {
    const part = parts.get(id)
    if (!part) continue
    const geometry: PolygonGeometry =
      part.polys.length === 1
        ? { type: 'Polygon', coordinates: part.polys[0] }
        : { type: 'MultiPolygon', coordinates: part.polys }
    const acres = part.props.PARCEL_ACRES
    found.push({
      parcelId: id,
      acres: typeof acres === 'number' && Number.isFinite(acres) ? acres : null,
      ownerLabel: asString(part.props.SUBDIV_NAME),
      propertyClass: asString(part.props.PROP_CLASS),
      geometry,
      centroid: centroidOf(geometry),
      asOf: asOfDate(part.props.CURRENT_ASOF),
    })
  }

  const foundIds = new Set(found.map((p) => p.parcelId))
  return { found, missing: wanted.filter((id) => !foundIds.has(id)) }
}
