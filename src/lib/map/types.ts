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
