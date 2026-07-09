'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
// maplibre-gl.css is imported in globals.css — a CSS import here (inside the
// ssr:false dynamic chunk) builds but never gets linked into the page.
import { buildMapStyle, type MapFlavor } from '@/lib/map/style'
import { MAP_HOME } from '@/lib/map/constants'
import type { MapProject, LineStringGeometry } from '@/lib/map/types'
import { buildMarkerElement, iconForProject, setMarkerSelected, SECTOR_LINE_COLOR } from './markers'

// Register the pmtiles protocol once per session
let protocolRegistered = false
function ensureProtocol() {
  if (protocolRegistered) return
  maplibregl.addProtocol('pmtiles', new Protocol().tile)
  protocolRegistered = true
}

export interface MapApi {
  flyHome: () => void
  flyTo: (lngLat: [number, number], zoom?: number) => void
}

interface MapViewProps {
  projects: MapProject[] // placed projects only (after sector filter)
  selectedId: string | null
  onSelect: (id: string) => void
  /** When set, next map click places this project. */
  placing: boolean
  onPlace: (lngLat: [number, number]) => void
  /** When true, clicks append rail-route vertices; Enter/double-click completes. */
  drawing: boolean
  drawColor: string
  onDrawComplete: (coords: [number, number][]) => void
  onDrawCancel: () => void
  /** Receives imperative controls (flyHome etc.) once the map exists. */
  apiRef: { current: MapApi | null }
  onBasemapError: () => void
}

function currentFlavor(): MapFlavor {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const LINE_SOURCE = 'project-lines'
const DRAW_SOURCE = 'draw-temp'

export default function MapView({
  projects,
  selectedId,
  onSelect,
  placing,
  onPlace,
  drawing,
  drawColor,
  onDrawComplete,
  onDrawCancel,
  apiRef,
  onBasemapError,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const drawCoordsRef = useRef<[number, number][]>([])
  // Keep latest callbacks reachable from stable map listeners
  const handlersRef = useRef({ onSelect, onPlace, onDrawComplete, onDrawCancel, placing, drawing, drawColor })
  handlersRef.current = { onSelect, onPlace, onDrawComplete, onDrawCancel, placing, drawing, drawColor }

  // ── Map lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    ensureProtocol()

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(currentFlavor(), window.location.origin),
      center: MAP_HOME.center,
      zoom: MAP_HOME.zoom,
      minZoom: 3,
      maxBounds: [
        [-130, 22],
        [-60, 52],
      ],
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('error', (e) => {
      // Surface a missing basemap (tile route 503) as a friendly notice
      const status = (e as { error?: { status?: number } }).error?.status
      if (status === 503) onBasemapError()
    })

    const overlays = () => ensureOverlays(map)
    map.on('style.load', overlays)

    map.on('click', (e) => {
      const h = handlersRef.current
      const lngLat: [number, number] = [
        Number(e.lngLat.lng.toFixed(6)),
        Number(e.lngLat.lat.toFixed(6)),
      ]
      if (h.drawing) {
        drawCoordsRef.current = [...drawCoordsRef.current, lngLat]
        updateDrawSource(map, drawCoordsRef.current, h.drawColor)
        return
      }
      if (h.placing) h.onPlace(lngLat)
    })

    map.on('dblclick', (e) => {
      const h = handlersRef.current
      if (!h.drawing) return
      e.preventDefault()
      // The dblclick was preceded by two clicks that both appended the same
      // final vertex — drop the duplicate.
      const coords = drawCoordsRef.current.slice(0, -1)
      if (coords.length >= 2) h.onDrawComplete(coords)
      else h.onDrawCancel()
    })

    apiRef.current = {
      flyHome: () => map.flyTo({ center: MAP_HOME.center, zoom: MAP_HOME.zoom, speed: 1.2, curve: 1.4 }),
      flyTo: (lngLat, zoom = 13.5) => map.flyTo({ center: lngLat, zoom, speed: 1.2, curve: 1.4 }),
    }

    // Follow the app's dark-mode toggle (class on <html>)
    const observer = new MutationObserver(() => {
      map.setStyle(buildMapStyle(currentFlavor(), window.location.origin))
      // style.load handler re-adds overlays
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    mapRef.current = map
    const markers = markersRef.current
    return () => {
      observer.disconnect()
      apiRef.current = null
      markers.forEach((m) => m.remove())
      markers.clear()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Line overlays (rail corridors etc.) ────────────────────────────────────
  function ensureOverlays(map: maplibregl.Map) {
    const features = projectsRef.current
      .filter((p): p is MapProject & { map_geometry: LineStringGeometry } => !!p.map_geometry)
      .map((p) => ({
        type: 'Feature' as const,
        properties: {
          id: p.id,
          color: SECTOR_LINE_COLOR[p.sector] ?? '#64748b',
        },
        geometry: p.map_geometry,
      }))
    const data = { type: 'FeatureCollection' as const, features }

    const existing = map.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
    } else {
      map.addSource(LINE_SOURCE, { type: 'geojson', data })
      map.addLayer({
        id: 'project-lines-glow',
        type: 'line',
        source: LINE_SOURCE,
        paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': 0.25, 'line-blur': 2 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addLayer({
        id: 'project-lines-main',
        type: 'line',
        source: LINE_SOURCE,
        paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.on('click', 'project-lines-main', (e) => {
        if (handlersRef.current.drawing || handlersRef.current.placing) return
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') handlersRef.current.onSelect(id)
      })
    }

    if (!map.getSource(DRAW_SOURCE)) {
      map.addSource(DRAW_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'draw-temp-line',
        type: 'line',
        source: DRAW_SOURCE,
        paint: { 'line-color': handlersRef.current.drawColor, 'line-width': 3, 'line-dasharray': [1.5, 1.5] },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addLayer({
        id: 'draw-temp-points',
        type: 'circle',
        source: DRAW_SOURCE,
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': handlersRef.current.drawColor,
        },
        filter: ['==', '$type', 'Point'],
      })
    }
  }

  function updateDrawSource(map: maplibregl.Map, coords: [number, number][], color: string) {
    const source = map.getSource(DRAW_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (!source) return
    if (map.getLayer('draw-temp-line')) {
      map.setPaintProperty('draw-temp-line', 'line-color', color)
      map.setPaintProperty('draw-temp-points', 'circle-stroke-color', color)
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        ...(coords.length >= 2
          ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } }]
          : []),
        ...coords.map((c) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: c },
        })),
      ],
    })
  }

  // ── Marker diffing ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = markersRef.current
    const next = new Set(projects.map((p) => p.id))

    for (const [id, marker] of markers) {
      if (!next.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }

    for (const p of projects) {
      if (p.latitude == null || p.longitude == null) continue
      let existing = markers.get(p.id)
      let wasSelected = false
      if (existing) {
        // The glyph/puck are baked into the element at creation — rebuild the
        // marker if the project's icon or sector changed since.
        const prevEl = existing.getElement()
        if (prevEl.dataset.icon !== iconForProject(p) || prevEl.dataset.sector !== p.sector) {
          wasSelected = prevEl.dataset.selected === 'true'
          existing.remove()
          markers.delete(p.id)
          existing = undefined
        } else {
          existing.setLngLat([p.longitude, p.latitude])
        }
      }
      if (!existing) {
        const el = buildMarkerElement(p)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (handlersRef.current.drawing || handlersRef.current.placing) return
          handlersRef.current.onSelect(p.id)
        })
        setMarkerSelected(el, wasSelected)
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([p.longitude, p.latitude])
          .addTo(map)
        markers.set(p.id, marker)
      }
    }

    // Refresh line overlays when geometry-bearing projects change
    if (map.isStyleLoaded()) ensureOverlays(map)
     
  }, [projects])

  // ── Selection highlight + fly ──────────────────────────────────────────────
  useEffect(() => {
    const markers = markersRef.current
    for (const [id, marker] of markers) {
      setMarkerSelected(marker.getElement(), id === selectedId)
    }
    if (selectedId) {
      const p = projects.find((x) => x.id === selectedId)
      if (p && p.latitude != null && p.longitude != null && mapRef.current) {
        const currentZoom = mapRef.current.getZoom()
        mapRef.current.flyTo({
          center: [p.longitude, p.latitude],
          zoom: Math.max(currentZoom, 11),
          speed: 1.2,
          curve: 1.4,
          // keep the marker visible left of the detail sheet on desktop
          padding: { right: window.innerWidth >= 640 ? 384 : 0 },
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ── Mode side-effects (cursor, draw reset, Esc/Enter) ─────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = placing || drawing ? 'crosshair' : ''
    if (drawing) {
      map.doubleClickZoom.disable()
    } else {
      map.doubleClickZoom.enable()
      drawCoordsRef.current = []
      if (map.isStyleLoaded()) updateDrawSource(map, [], drawColor)
    }

    if (!placing && !drawing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handlersRef.current.onDrawCancel()
      } else if (e.key === 'Enter' && handlersRef.current.drawing) {
        const coords = drawCoordsRef.current
        if (coords.length >= 2) handlersRef.current.onDrawComplete(coords)
        else handlersRef.current.onDrawCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, drawing, drawColor])

  // Inline style, not utilities: maplibre-gl.css sets `.maplibregl-map
  // { position: relative }` unlayered, which beats Tailwind's layered
  // `absolute inset-0` and collapses the container to 0 height.
  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
