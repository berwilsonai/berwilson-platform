/**
 * Import a parcel schedule onto a record.
 *
 * Shared by the API route and by scripts. Agent tools and scripts never fetch
 * the app's own HTTP routes (CLAUDE.md §12) — the logic lives here so both
 * callers get the same behaviour.
 *
 * THE SCHEDULE IS THE HUMAN'S, THE GEOMETRY IS THE COUNTY'S. Acreage, status
 * and zoning are whatever the application or contract asserts, and are written
 * exactly as given. Geometry and `assessor_acres` come from Utah AGRC and are
 * never allowed to overwrite the deal's own figures — they sit beside them so a
 * disagreement stays visible rather than being quietly resolved.
 */

import { lookupParcels, type PolygonGeometry } from './agrc'
import { parcelDb, type ParcelStatus } from './queries'

export interface ScheduleEntry {
  parcelId: string
  label?: string | null
  acres?: number | null
  status?: ParcelStatus
  color?: string | null
  ownerName?: string | null
  existingZone?: string | null
  requestedZone?: string | null
  notes?: string | null
}

export interface ImportOptions {
  projectId: string
  county: string
  schedule: ScheduleEntry[]
  /** Skip the AGRC lookup entirely — schedule only, no geometry. */
  textOnly?: boolean
}

export interface ImportResult {
  written: number
  withGeometry: number
  /** Ids the county layer has no row for — usually split or merged since. */
  missingFromCounty: string[]
  /** parcelId → [scheduleAcres, assessorAcres] where the two disagree. */
  acreageDisagreements: { parcelId: string; schedule: number; assessor: number }[]
  /** Set when the lookup could not run at all, so an empty result is not read as "none found". */
  lookupError: string | null
}

/**
 * Parse a pasted parcel schedule.
 *
 * Accepts the shape a county exhibit table actually copies as: an id, then an
 * acreage, then an optional status, separated by tabs, commas, pipes or runs of
 * spaces. A line with no recognisable acreage still imports — a parcel with an
 * unknown size is a real state, and dropping the row would hide it.
 */
export function parseSchedule(text: string): ScheduleEntry[] {
  const entries: ScheduleEntry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const cells = line.split(/\t|\s*\|\s*|,|\s{2,}/).map((c) => c.trim()).filter(Boolean)
    if (cells.length === 0) continue

    // A header row: no cell looks like a parcel number.
    const parcelId = cells[0]
    if (/^(parcel|id|apn|tax)\b/i.test(parcelId)) continue

    let acres: number | null = null
    let status: ParcelStatus | undefined
    for (const cell of cells.slice(1)) {
      const asNumber = Number(cell.replace(/[, ]/g, '').replace(/ac(res)?$/i, ''))
      if (acres == null && Number.isFinite(asNumber) && asNumber > 0) {
        acres = asNumber
        continue
      }
      const lowered = cell.toLowerCase()
      if (lowered === 'subject' || lowered === 'adjacent' || lowered === 'excluded' || lowered === 'acquired') {
        status = lowered
      }
    }
    entries.push({ parcelId, acres, status: status ?? 'subject' })
  }
  return entries
}

export async function importParcels(options: ImportOptions): Promise<ImportResult> {
  const { projectId, county, schedule, textOnly } = options

  const geometryById = new Map<
    string,
    { geometry: PolygonGeometry; lat: number; lng: number; acres: number | null; asOf: string | null; owner: string | null }
  >()
  let missingFromCounty: string[] = []
  let lookupError: string | null = null

  if (!textOnly) {
    try {
      const result = await lookupParcels(county, schedule.map((s) => s.parcelId))
      for (const p of result.found) {
        geometryById.set(p.parcelId, {
          geometry: p.geometry,
          lat: p.centroid.lat,
          lng: p.centroid.lng,
          acres: p.acres,
          asOf: p.asOf,
          owner: p.ownerLabel,
        })
      }
      missingFromCounty = result.missing
    } catch (err) {
      // A failed lookup must never masquerade as "the county has no such
      // parcels" (CLAUDE.md §12: a fallback is a conclusion, and it can only be
      // drawn from a check that ran). The schedule still imports; the geometry
      // is simply absent and the reason is reported.
      lookupError = err instanceof Error ? err.message : String(err)
    }
  }

  const acreageDisagreements: ImportResult['acreageDisagreements'] = []
  const rows = schedule.map((entry, index) => {
    const cadastre = geometryById.get(entry.parcelId)
    if (
      entry.acres != null &&
      cadastre?.acres != null &&
      Math.abs(entry.acres - cadastre.acres) > 0.05
    ) {
      acreageDisagreements.push({
        parcelId: entry.parcelId,
        schedule: entry.acres,
        assessor: cadastre.acres,
      })
    }
    return {
      project_id: projectId,
      parcel_id: entry.parcelId,
      // Strip the county prefix for the map label: on a sheet showing one
      // county's parcels, "HD-" is on every single one and carries nothing.
      label: entry.label ?? entry.parcelId.replace(/^[A-Z]{1,3}-/, ''),
      acres: entry.acres ?? null,
      assessor_acres: cadastre?.acres ?? null,
      owner_name: entry.ownerName ?? null,
      existing_zone: entry.existingZone ?? null,
      requested_zone: entry.requestedZone ?? null,
      status: entry.status ?? 'subject',
      geometry: cadastre?.geometry ?? null,
      centroid_lat: cadastre?.lat ?? null,
      centroid_lng: cadastre?.lng ?? null,
      geometry_source: cadastre ? 'utah_agrc' : null,
      geometry_asof: cadastre?.asOf ?? null,
      color: entry.color ?? null,
      notes: entry.notes ?? null,
      sort_order: index,
    }
  })

  // Re-importing a corrected schedule is the normal case, so this upserts on
  // the record+parcel key rather than stacking near-duplicate rows beside the
  // originals.
  const { error } = await parcelDb()
    .from('project_parcels')
    .upsert(rows, { onConflict: 'project_id,opportunity_id,parcel_id' })
  if (error) throw new Error(error.message)

  return {
    written: rows.length,
    withGeometry: rows.filter((r) => r.geometry).length,
    missingFromCounty,
    acreageDisagreements,
    lookupError,
  }
}
