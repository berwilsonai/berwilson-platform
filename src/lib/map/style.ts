import { layers, namedFlavor } from '@protomaps/basemaps'
import type maplibregl from 'maplibre-gl'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'

// Fully offline MapLibre style: vector tiles from our per-tile route (which
// composites the world-overview + full-detail-regions archives server-side),
// fonts + sprites vendored into public/basemaps/ (scripts/setup-map-data.sh).
// Nothing here may reference a CDN — the platform is tailnet-only.

export type MapFlavor = 'light' | 'dark'

export const RAIL_SOURCE = 'rail'
export const RAIL_SOURCE_LAYER = 'rail'
/** The basemap's own (OSM) rail hairline — hidden while our NARN layer draws. */
export const BASEMAP_RAIL_LAYER = 'roads_rail'
export const RAIL_LAYERS = {
  other: 'rail-other',
  strac: 'rail-stracnet',
  connector: 'rail-connector',
} as const

// Rail reads as infrastructure, not as a sector: graphite/slate, deliberately
// outside the sector palette in markers.tsx (blue/amber/emerald/violet/sky/
// rose) so a rail corridor is never mistaken for a project line. STRACNET —
// the DoD strategic network — carries the weight; everything else is context
// underneath it.
const RAIL_COLORS: Record<MapFlavor, { strac: string; other: string }> = {
  light: { strac: '#334155', other: '#94a3b8' },
  dark: { strac: '#e2e8f0', other: '#64748b' },
}

/**
 * The NARN layers, in draw order, to be spliced in above the basemap's roads
 * and below its boundaries and labels — place names stay readable over rail.
 */
function railLayers(flavor: MapFlavor): LayerSpecification[] {
  const c = RAIL_COLORS[flavor]
  const common = {
    source: RAIL_SOURCE,
    'source-layer': RAIL_SOURCE_LAYER,
    layout: {
      'line-cap': 'round' as const,
      'line-join': 'round' as const,
      visibility: 'none' as const,
    },
  }
  const stracWidth: maplibregl.ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    3,
    0.6,
    7,
    1.4,
    11,
    2.6,
    14,
    4,
  ]
  return [
    {
      ...common,
      id: RAIL_LAYERS.other,
      type: 'line',
      filter: ['!', ['has', 'strac']],
      paint: {
        'line-color': c.other,
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 9, 0.9, 13, 1.8],
      },
    },
    {
      // Defense connector lines — the spurs that reach an installation or a
      // port. Dashed, as they are on DoD's own published sheet, and the same
      // colour: they are one network, drawn as two kinds of member.
      ...common,
      id: RAIL_LAYERS.connector,
      type: 'line',
      filter: ['==', ['get', 'strac'], 'C'],
      paint: {
        'line-color': c.strac,
        'line-width': stracWidth,
        'line-dasharray': [2.5, 1.5],
      },
    },
    {
      ...common,
      id: RAIL_LAYERS.strac,
      type: 'line',
      filter: ['==', ['get', 'strac'], 'S'],
      paint: {
        'line-color': c.strac,
        'line-width': stracWidth,
      },
    },
  ]
}

export function buildMapStyle(flavor: MapFlavor, origin: string): StyleSpecification {
  const base = layers('protomaps', namedFlavor(flavor), { lang: 'en' })
  // Splice directly after the basemap's own rail hairline: above roads and
  // buildings, below boundaries and every label. Appending instead would put
  // rail over place names — and MapView appends the project overlays, which
  // must stay on top of both.
  const at = base.findIndex((l) => l.id === BASEMAP_RAIL_LAYER)
  const insertAt = at === -1 ? base.length : at + 1
  const withRail = [...base.slice(0, insertAt), ...railLayers(flavor), ...base.slice(insertAt)]

  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        tiles: [origin + '/api/map/tiles/{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: 15,
        attribution: '© OpenStreetMap',
      },
      [RAIL_SOURCE]: {
        type: 'vector',
        tiles: [origin + '/api/map/rail/{z}/{x}/{y}'],
        minzoom: 0,
        // Matches the archive's --maximum-zoom; MapLibre overzooms above it.
        maxzoom: 12,
        attribution: 'Rail: BTS/NTAD North American Rail Network',
      },
    },
    // MapLibre requires absolute URLs for glyphs/sprite
    glyphs: origin + '/basemaps/fonts/{fontstack}/{range}.pbf',
    sprite: origin + '/basemaps/sprites/v4/' + flavor,
    layers: withRail,
  }
}
