/**
 * Parcel reads and writes.
 *
 * `project_parcels` arrives in migration 20260928000001, and `npm run gen-types`
 * is a hard-disabled stub (CLAUDE.md §4), so the generated Database type has no
 * idea this table exists. Following the established convention rather than
 * scattering `as never` casts: one deliberately untyped service-role client,
 * with the row interface below carrying the contract instead. When gen-types is
 * repaired this collapses into createAdminClient().
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'
import type { Refine, SelectedCols, Tables } from '@/lib/supabase/types'
import type { PolygonGeometry } from './agrc'

export function parcelDb() {
  return createUntypedAdminClient()
}

export const PARCEL_STATUSES = ['subject', 'adjacent', 'excluded', 'acquired'] as const
export type ParcelStatus = (typeof PARCEL_STATUSES)[number]

export const PARCEL_STATUS_LABELS: Record<ParcelStatus, string> = {
  subject: 'Subject',
  adjacent: 'Adjacent',
  excluded: 'Excluded',
  acquired: 'Acquired',
}


// One literal, not a concatenation: `as const` only applies to a literal, and
// it is the `as const` that lets ParcelRow below be derived from this list.
const COLUMNS = 'id,project_id,opportunity_id,parcel_id,label,acres,assessor_acres,owner_name,existing_zone,requested_zone,status,geometry,centroid_lat,centroid_lng,geometry_source,geometry_asof,color,notes,sort_order' as const

/**
 * A parcel as the reads below project it.
 *
 * ⚠ DERIVED FROM `COLUMNS`, NOT HAND-WRITTEN. The previous version listed all
 * twenty-two fields by hand and had drifted: created_at and updated_at were
 * absent, and `sort_order` was typed `number` against a nullable column (made
 * NOT NULL in migration 20261008000005). Now the select list IS the type, so a
 * column added to one is added to the other.
 */
export type ParcelRow = Refine<
  Pick<Tables<'project_parcels'>, SelectedCols<typeof COLUMNS>>,
  {
    /** A real GeoJSON Polygon/MultiPolygon, not bare `Json`. */
    geometry: PolygonGeometry | null
    status: ParcelStatus
  }
>

export async function getProjectParcels(projectId: string): Promise<ParcelRow[]> {
  const { data, error } = await parcelDb()
    .from('project_parcels')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('parcel_id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ParcelRow[]
}

/**
 * Every drawable parcel across the portfolio, for /map.
 *
 * Deliberately ONE query rather than per-project: the map already holds every
 * project in memory and a fan-out would be a request per project. Paginated
 * because PostgREST truncates at 1000 rows in silence (CLAUDE.md §12) — a
 * portfolio of large assemblages reaches that sooner than it looks.
 */
export async function getAllDrawableParcels(): Promise<ParcelRow[]> {
  const db = parcelDb()
  const page = 1000
  const rows: ParcelRow[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from('project_parcels')
      .select(COLUMNS)
      .not('geometry', 'is', null)
      .not('project_id', 'is', null)
      .order('project_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as ParcelRow[]
    rows.push(...batch)
    if (batch.length < page) break
  }
  return rows
}

export interface ParcelTotals {
  count: number
  /** Deal acreage, falling back to the assessor's where the deal has none. */
  acres: number
  /** Parcels whose deal figure and county figure disagree by more than a rounding. */
  disputed: ParcelRow[]
  withGeometry: number
}

/**
 * The figures an executive repeats out loud, computed rather than read off a
 * model's summary of a table (CLAUDE.md §12: never make the model count rows).
 */
export function parcelTotals(parcels: ParcelRow[]): ParcelTotals {
  let acres = 0
  let withGeometry = 0
  const disputed: ParcelRow[] = []
  for (const p of parcels) {
    if (p.status === 'excluded') continue
    const deal = p.acres ?? p.assessor_acres
    if (deal != null) acres += Number(deal)
    if (p.geometry) withGeometry += 1
    if (
      p.acres != null &&
      p.assessor_acres != null &&
      Math.abs(Number(p.acres) - Number(p.assessor_acres)) > 0.05
    ) {
      disputed.push(p)
    }
  }
  return {
    count: parcels.filter((p) => p.status !== 'excluded').length,
    acres: Math.round(acres * 100) / 100,
    disputed,
    withGeometry,
  }
}
