// Shared map constants — importable from server routes and client components
// (no maplibre imports here).

export const MAP_ICON_TYPES = [
  'data_center',
  'rail',
  'hospital',
  'housing',
  'power',
  'industrial',
  'government',
  'office',
  'water',
  'default',
] as const

export type MapIconType = (typeof MAP_ICON_TYPES)[number]

export const MAP_ICON_LABELS: Record<MapIconType, string> = {
  data_center: 'Data Center',
  rail: 'Rail',
  hospital: 'Hospital',
  housing: 'Housing',
  power: 'Power',
  industrial: 'Industrial',
  government: 'Government',
  office: 'Office',
  water: 'Water',
  default: 'General',
}

export function isMapIconType(v: unknown): v is MapIconType {
  return typeof v === 'string' && (MAP_ICON_TYPES as readonly string[]).includes(v)
}

// Pipeline vs awarded work: pre-award stages read as pursuit; award+ is won.
// Drives the map's phase filter and the solid-vs-outlined marker styles.
export type MapPhase = 'awarded' | 'pipeline'

export const MAP_PHASES: MapPhase[] = ['awarded', 'pipeline']

export const MAP_PHASE_LABELS: Record<MapPhase, string> = {
  awarded: 'Awarded',
  pipeline: 'Pipeline',
}

export function projectPhase(stage: string | null | undefined): MapPhase {
  return stage === 'award' ||
    stage === 'mobilization' ||
    stage === 'execution' ||
    stage === 'closeout'
    ? 'awarded'
    : 'pipeline'
}

// Utah default camera; US-wide basemap underneath for the nationwide future.
export const MAP_HOME = { center: [-111.6, 39.4] as [number, number], zoom: 6.3 }

// Max stored GeoJSON size for map_geometry (rail corridors etc.)
export const MAP_GEOMETRY_MAX_BYTES = 100_000
