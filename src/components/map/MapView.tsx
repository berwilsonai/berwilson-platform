'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
// maplibre-gl.css is imported in globals.css — a CSS import here (inside the
// ssr:false dynamic chunk) builds but never gets linked into the page.
import { buildMapStyle, type MapFlavor } from '@/lib/map/style'
import { MAP_HOME } from '@/lib/map/constants'
import type { MapProject, LineStringGeometry } from '@/lib/map/types'
import {
  buildClusterElement,
  buildMarkerElement,
  iconForProject,
  markerVariant,
  setMarkerSelected,
  SECTOR_LINE_COLOR,
} from './markers'

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
  /** Project whose route is being (re)drawn — its saved line hides while drawing. */
  drawingProjectId: string | null
  drawColor: string
  onDrawComplete: (coords: [number, number][]) => void
  onDrawCancel: () => void
  /** Receives imperative controls (flyHome etc.) once the map exists. */
  apiRef: { current: MapApi | null }
  onBasemapError: () => void
  /** Animate a dash-flow along route lines (present mode). */
  animateLines: boolean
}

function currentFlavor(): MapFlavor {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const LINE_SOURCE = 'project-lines'
const DRAW_SOURCE = 'draw-temp'
const DASH_LAYER = 'project-lines-dash'
// Above this zoom, marker labels stay visible (not just on hover)
const LABEL_ZOOM = 9
// Screen-space clustering: markers within this pixel radius merge into a
// count puck; past CLUSTER_MAX_ZOOM they never cluster (same-site escape hatch).
const CLUSTER_RADIUS = 48
const CLUSTER_MAX_ZOOM = 14

// Ant-path frames for the present-mode route animation (maplibre's
// line-dasharray doesn't interpolate, so we cycle discrete patterns).
const DASH_SEQUENCE: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
]

export default function MapView({
  projects,
  selectedId,
  onSelect,
  placing,
  onPlace,
  drawing,
  drawingProjectId,
  drawColor,
  onDrawComplete,
  onDrawCancel,
  apiRef,
  onBasemapError,
  animateLines,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const clustersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const animateRef = useRef(animateLines)
  animateRef.current = animateLines
  const drawCoordsRef = useRef<[number, number][]>([])
  // Keep latest callbacks reachable from stable map listeners
  const handlersRef = useRef({ onSelect, onPlace, onDrawComplete, onDrawCancel, placing, drawing, drawingProjectId, drawColor })
  handlersRef.current = { onSelect, onPlace, onDrawComplete, onDrawCancel, placing, drawing, drawingProjectId, drawColor }

  // ── Map lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    ensureProtocol()

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(currentFlavor(), window.location.origin),
      center: MAP_HOME.center,
      zoom: MAP_HOME.zoom,
      // No maxBounds: projects now span beyond the US (Tonga, Albania) — the
      // camera roams worldwide; basemap detail exists where the extract covers.
      minZoom: 1.5,
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

    // Persistent marker labels when zoomed in — markers.tsx keys off this attr
    const syncLabels = () => {
      containerRef.current?.setAttribute(
        'data-map-labels',
        map.getZoom() >= LABEL_ZOOM ? 'true' : 'false'
      )
    }
    map.on('zoom', syncLabels)
    syncLabels()

    // Re-group overlapping markers whenever the camera settles
    map.on('moveend', () => refreshClusters(map))

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
    const clusters = clustersRef.current
    return () => {
      observer.disconnect()
      apiRef.current = null
      markers.forEach((m) => m.remove())
      markers.clear()
      clusters.forEach((m) => m.remove())
      clusters.clear()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Screen-space clustering ────────────────────────────────────────────────
  // Greedy pixel-radius grouping recomputed on camera settle / data change.
  // The selected project never clusters, so tour/selection highlights survive.
  function refreshClusters(map: maplibregl.Map) {
    const markers = markersRef.current
    const clusters = clustersRef.current
    type Group = { members: MapProject[]; x: number; y: number }
    const groups: Group[] = []

    if (map.getZoom() < CLUSTER_MAX_ZOOM) {
      const pts = projectsRef.current
        .filter(
          (p) =>
            p.latitude != null && p.longitude != null && p.id !== selectedRef.current
        )
        .map((p) => ({
          p,
          pt: map.project([p.longitude as number, p.latitude as number]),
        }))
      const used = new Set<string>()
      for (const a of pts) {
        if (used.has(a.p.id)) continue
        used.add(a.p.id)
        const g: Group = { members: [a.p], x: a.pt.x, y: a.pt.y }
        for (const b of pts) {
          if (used.has(b.p.id)) continue
          if (Math.hypot(b.pt.x - a.pt.x, b.pt.y - a.pt.y) <= CLUSTER_RADIUS) {
            used.add(b.p.id)
            g.members.push(b.p)
            g.x += b.pt.x
            g.y += b.pt.y
          }
        }
        if (g.members.length >= 2) groups.push(g)
      }
    }

    const hidden = new Set(groups.flatMap((g) => g.members.map((m) => m.id)))
    for (const [id, marker] of markers) {
      marker.getElement().style.display = hidden.has(id) ? 'none' : ''
    }

    const nextKeys = new Set<string>()
    for (const g of groups) {
      const key = g.members
        .map((m) => m.id)
        .sort()
        .join('|')
      nextKeys.add(key)
      const centroid = map.unproject([g.x / g.members.length, g.y / g.members.length])
      const existing = clusters.get(key)
      if (existing) {
        existing.setLngLat(centroid)
        continue
      }
      const first: [number, number] = [
        g.members[0].longitude as number,
        g.members[0].latitude as number,
      ]
      const bounds = g.members.reduce(
        (b, m) => b.extend([m.longitude as number, m.latitude as number]),
        new maplibregl.LngLatBounds(first, first)
      )
      const el = buildClusterElement(g.members)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (handlersRef.current.drawing || handlersRef.current.placing) return
        map.fitBounds(bounds, { padding: 120, maxZoom: CLUSTER_MAX_ZOOM + 0.5 })
      })
      clusters.set(
        key,
        new maplibregl.Marker({ element: el }).setLngLat(centroid).addTo(map)
      )
    }
    for (const [key, marker] of clusters) {
      if (!nextKeys.has(key)) {
        marker.remove()
        clusters.delete(key)
      }
    }
  }

  // ── Line overlays (rail corridors etc.) ────────────────────────────────────
  function ensureOverlays(map: maplibregl.Map) {
    const features = projectsRef.current
      .filter((p): p is MapProject & { map_geometry: LineStringGeometry } => !!p.map_geometry)
      // Hide the saved route while it's being redrawn — the dashed draw line replaces it
      .filter((p) => p.id !== handlersRef.current.drawingProjectId)
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
      // Present-mode dash-flow overlay; the animation effect toggles visibility
      map.addLayer({
        id: DASH_LAYER,
        type: 'line',
        source: LINE_SOURCE,
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.8,
          'line-width': 1.6,
          'line-dasharray': DASH_SEQUENCE[0],
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: animateRef.current ? 'visible' : 'none',
        },
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
        // The glyph/puck/size are baked into the element at creation — rebuild
        // the marker if the project's icon, sector, phase, or tier changed.
        const prevEl = existing.getElement()
        if (
          prevEl.dataset.icon !== iconForProject(p) ||
          prevEl.dataset.sector !== p.sector ||
          prevEl.dataset.variant !== markerVariant(p)
        ) {
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
    refreshClusters(map)

  }, [projects])

  // ── Selection highlight + fly ──────────────────────────────────────────────
  useEffect(() => {
    const markers = markersRef.current
    for (const [id, marker] of markers) {
      setMarkerSelected(marker.getElement(), id === selectedId)
    }
    // Selected marker is exempt from clustering — pull it out immediately
    // (the flyTo's moveend refreshes again once the camera settles)
    if (mapRef.current) refreshClusters(mapRef.current)
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
      } else if (p?.map_geometry && mapRef.current) {
        // Route-only project (no marker) — frame the whole line
        const coords = p.map_geometry.coordinates
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0])
        )
        mapRef.current.fitBounds(bounds, {
          speed: 1.2,
          curve: 1.4,
          maxZoom: 12,
          padding: { top: 60, bottom: 60, left: 60, right: window.innerWidth >= 640 ? 384 + 60 : 60 },
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ── Route dash-flow animation (present mode) ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animateLines || reduceMotion) {
      if (map.getLayer(DASH_LAYER)) map.setLayoutProperty(DASH_LAYER, 'visibility', 'none')
      return
    }
    if (map.getLayer(DASH_LAYER)) map.setLayoutProperty(DASH_LAYER, 'visibility', 'visible')
    let step = -1
    let raf = 0
    const tick = (t: number) => {
      const next = Math.floor(t / 80) % DASH_SEQUENCE.length
      if (next !== step) {
        step = next
        if (map.getLayer(DASH_LAYER)) {
          map.setPaintProperty(DASH_LAYER, 'line-dasharray', DASH_SEQUENCE[step])
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (map.getLayer(DASH_LAYER)) map.setLayoutProperty(DASH_LAYER, 'visibility', 'none')
    }
  }, [animateLines])

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
    // Entering/leaving redraw hides/restores that project's saved line
    if (map.isStyleLoaded()) ensureOverlays(map)

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
  // group/maplabels: marker labels read data-map-labels off this ancestor.
  return <div ref={containerRef} className="group/maplabels" style={{ position: 'absolute', inset: 0 }} />
}
