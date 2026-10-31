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

// Pipeline vs awarded work. Drives the map's phase filter and the
// solid-vs-outlined marker styles.
export type MapPhase = 'awarded' | 'pipeline'

export const MAP_PHASES: MapPhase[] = ['awarded', 'pipeline']

export const MAP_PHASE_LABELS: Record<MapPhase, string> = {
  awarded: 'Awarded',
  pipeline: 'Pipeline',
}

/**
 * Has this deal been won, or is it still being chased?
 *
 * ⚠ IT TESTED FOUR STAGES THAT NO LONGER EXIST (fixed 10-30). The old
 * vocabulary's post-award half was award / mobilization / execution /
 * closeout, and this compared against all four as plain strings — so after
 * the rename every single project answered `pipeline`, the map's Awarded
 * filter returned nothing, and every marker drew outlined. §12: a green
 * typecheck is not coverage; this takes `string`, so nothing could see it.
 *
 * `won` is the whole post-award half now. `lost` is deliberately NOT awarded
 * and not pipeline either — it is neither, and it falls to `pipeline` here
 * because the map's filter is binary. A lost deal on the Awarded layer would
 * be the worse error of the two.
 */
export function projectPhase(stage: string | null | undefined): MapPhase {
  return stage === 'won' ? 'awarded' : 'pipeline'
}

// Utah default camera; US-wide basemap underneath for the nationwide future.
export const MAP_HOME = { center: [-111.6, 39.4] as [number, number], zoom: 6.3 }

// Max stored GeoJSON size for map_geometry (rail corridors etc.)
export const MAP_GEOMETRY_MAX_BYTES = 100_000

// Rail display. The North American Rail Network is context under the
// portfolio, so it is off by default; STRACNET — the DoD strategic corridor
// network — is the layer that matters for a government-contracting siting
// question, and the whole network is there for the follow-up ("is there any
// rail at all near this parcel").
export type RailMode = 'off' | 'stracnet' | 'all'

export const RAIL_MODES: RailMode[] = ['off', 'stracnet', 'all']

export const RAIL_MODE_LABELS: Record<RailMode, string> = {
  off: 'Off',
  stracnet: 'STRACNET',
  all: 'All rail',
}

export function isRailMode(v: unknown): v is RailMode {
  return typeof v === 'string' && (RAIL_MODES as string[]).includes(v)
}
