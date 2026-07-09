import { layers, namedFlavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'

// Fully offline MapLibre style: vector tiles from our range-serving route,
// fonts + sprites vendored into public/basemaps/ (scripts/setup-map-data.sh).
// Nothing here may reference a CDN — the platform is tailnet-only.

export type MapFlavor = 'light' | 'dark'

export function buildMapStyle(flavor: MapFlavor, origin: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: 'pmtiles://' + origin + '/api/map/tiles',
        attribution: '© OpenStreetMap',
      },
    },
    // MapLibre requires absolute URLs for glyphs/sprite
    glyphs: origin + '/basemaps/fonts/{fontstack}/{range}.pbf',
    sprite: origin + '/basemaps/sprites/v4/' + flavor,
    layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' }),
  }
}
