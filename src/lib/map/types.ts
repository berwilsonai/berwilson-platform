import type { Project } from '@/lib/supabase/types'

// Map columns land via migration 20260709000001; optional so the page stays
// dual-schema tolerant, and map_geometry narrowed from Json to its real shape.
export type MapProject = Omit<
  Project,
  'latitude' | 'longitude' | 'map_icon' | 'map_geometry'
> & {
  latitude?: number | null
  longitude?: number | null
  map_icon?: string | null
  map_geometry?: LineStringGeometry | null
}

export interface LineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

/**
 * A parcel as the map needs it — the polygon, its label, and the project it
 * belongs to. Deliberately narrower than the full `project_parcels` row: the
 * map draws thousands of vertices and has no use for zoning text or notes, and
 * shipping them would put the whole schedule into the client bundle twice
 * (once here, once in the project's own Land tab).
 */
export interface MapParcel {
  id: string
  projectId: string
  parcelId: string
  label: string | null
  acres: number | null
  color: string | null
  geometry: PolygonGeometry
}

export type PolygonGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
