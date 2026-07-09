'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Home, Presentation, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectSector } from '@/lib/supabase/types'
import { SECTORS, SECTOR_LABELS, SECTOR_BADGE } from '@/lib/utils/constants'
import type { MapIconType } from '@/lib/map/constants'
import type { MapProject, LineStringGeometry } from '@/lib/map/types'
import type { MapApi } from './MapView'
import ProjectMapSheet from './ProjectMapSheet'
import PlacementPanel from './PlacementPanel'

function MapSkeleton() {
  return <div className="absolute inset-0 animate-pulse bg-muted" />
}

// maplibre-gl is browser-only — this dynamic() is the SSR firewall
const MapView = dynamic(() => import('./MapView'), { ssr: false, loading: MapSkeleton })

interface MapPageClientProps {
  projects: MapProject[]
  photoUrls: Record<string, string[]>
  isAdmin: boolean
}

type Override = Partial<
  Pick<MapProject, 'latitude' | 'longitude' | 'map_icon' | 'map_geometry'>
>

export default function MapPageClient({ projects, photoUrls, isAdmin }: MapPageClientProps) {
  const router = useRouter()
  const apiRef = useRef<MapApi | null>(null)

  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placingId, setPlacingId] = useState<string | null>(null)
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [present, setPresent] = useState(false)
  const [hiddenSectors, setHiddenSectors] = useState<Set<ProjectSector>>(new Set())
  const [basemapMissing, setBasemapMissing] = useState(false)

  const merged = useMemo(
    () => projects.map((p) => (overrides[p.id] ? { ...p, ...overrides[p.id] } : p)),
    [projects, overrides]
  )
  // A project is "on the map" with a marker, a drawn route, or both —
  // rail corridors are often route-only, no point marker.
  const placed = useMemo(
    () =>
      merged.filter(
        (p) => (p.latitude != null && p.longitude != null) || p.map_geometry
      ),
    [merged]
  )
  const unplaced = useMemo(
    () => merged.filter((p) => !placed.includes(p)),
    [merged, placed]
  )
  const visible = useMemo(
    () => (hiddenSectors.size ? placed.filter((p) => !hiddenSectors.has(p.sector)) : placed),
    [placed, hiddenSectors]
  )
  const sectorsInUse = useMemo(
    () => SECTORS.filter((s) => placed.some((p) => p.sector === s)),
    [placed]
  )

  const selected = selectedId ? merged.find((p) => p.id === selectedId) ?? null : null
  const activeTarget = placingId ?? drawingId
  const activeTargetName = activeTarget
    ? merged.find((p) => p.id === activeTarget)?.name ?? ''
    : ''

  async function patchProject(id: string, fields: Override): Promise<boolean> {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'Save failed')
      return false
    }
    return true
  }

  async function saveFields(id: string, fields: Override) {
    const prev = overrides[id]
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...fields } }))
    const ok = await patchProject(id, fields)
    if (!ok) {
      setOverrides((o) => ({ ...o, [id]: { ...prev } }))
      return
    }
    router.refresh()
  }

  function handlePlace(lngLat: [number, number]) {
    if (!placingId) return
    const id = placingId
    setPlacingId(null)
    void saveFields(id, { longitude: lngLat[0], latitude: lngLat[1] })
    setSelectedId(id)
  }

  function handleDrawComplete(coords: [number, number][]) {
    if (!drawingId) return
    const id = drawingId
    setDrawingId(null)
    const geometry: LineStringGeometry = { type: 'LineString', coordinates: coords }
    void saveFields(id, { map_geometry: geometry })
    toast.success('Route saved')
  }

  const cancelModes = useCallback(() => {
    setPlacingId(null)
    setDrawingId(null)
  }, [])

  // Present mode: overlay covers the app chrome; browser fullscreen on top.
  // documentElement (not the map div) so portaled sheets stay visible.
  useEffect(() => {
    if (present) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
    const sync = () => {
      if (!document.fullscreenElement) setPresent(false)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [present])

  const drawColor = '#f59e0b'

  return (
    <div
      className={
        present
          ? 'fixed inset-0 z-40 bg-background'
          : 'relative h-[calc(100dvh-10.5rem)] min-h-[480px] overflow-hidden rounded-xl border border-border elev-1'
      }
    >
      <MapView
        projects={visible}
        selectedId={selectedId}
        onSelect={setSelectedId}
        placing={!!placingId}
        onPlace={handlePlace}
        drawing={!!drawingId}
        drawingProjectId={drawingId}
        drawColor={drawColor}
        onDrawComplete={handleDrawComplete}
        onDrawCancel={cancelModes}
        apiRef={apiRef}
        onBasemapError={() => setBasemapMissing(true)}
      />

      {/* Toolbar */}
      <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-6rem)] flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm elev-1">
          <button
            onClick={() => apiRef.current?.flyHome()}
            title="Back to Utah"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Home size={14} />
          </button>
          <button
            onClick={() => setPresent(!present)}
            title={present ? 'Exit present mode' : 'Present (fullscreen)'}
            className={`inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent ${present ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {present ? <X size={14} /> : <Presentation size={14} />}
          </button>
        </div>

        {/* Sector legend / filter */}
        {sectorsInUse.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm elev-1">
            {sectorsInUse.map((s) => {
              const off = hiddenSectors.has(s)
              return (
                <button
                  key={s}
                  onClick={() =>
                    setHiddenSectors((prev) => {
                      const next = new Set(prev)
                      if (next.has(s)) next.delete(s)
                      else next.add(s)
                      return next
                    })
                  }
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-opacity ${SECTOR_BADGE[s]} ${off ? 'opacity-35' : ''}`}
                >
                  {SECTOR_LABELS[s]}
                </button>
              )
            })}
          </div>
        )}

        <span className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-muted-foreground shadow-sm elev-1">
          <span className="tnum">{visible.length}</span> on map
        </span>
      </div>

      {/* Placement / drawing banner */}
      {activeTarget && (
        <div className="absolute inset-x-0 top-4 z-10 flex justify-center px-16">
          <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-md dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-200">
            <span>
              {placingId
                ? `Click the map to place “${activeTargetName}”`
                : `Click to add route points for “${activeTargetName}” — Enter or double-click to finish`}
            </span>
            <button
              onClick={cancelModes}
              className="rounded-md border border-amber-300 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-900"
            >
              Cancel (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Basemap missing notice */}
      {basemapMissing && (
        <div className="absolute inset-x-0 bottom-16 z-10 flex justify-center px-4">
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-md">
            Basemap not installed on this machine — run <code className="font-mono">scripts/setup-map-data.sh</code>, then redeploy.
          </div>
        </div>
      )}

      {isAdmin && !activeTarget && (
        <PlacementPanel
          unplaced={unplaced}
          placedCount={placed.length}
          total={merged.length}
          onStartPlace={(id) => {
            setSelectedId(null)
            setPlacingId(id)
          }}
          onStartDraw={(id) => {
            setSelectedId(null)
            setDrawingId(id)
          }}
        />
      )}

      <ProjectMapSheet
        project={selected}
        photoUrls={selected ? photoUrls[selected.id] ?? [] : []}
        isAdmin={isAdmin}
        onClose={() => setSelectedId(null)}
        onReposition={(id) => {
          setSelectedId(null)
          setPlacingId(id)
        }}
        onDrawRoute={(id) => {
          setSelectedId(null)
          setDrawingId(id)
        }}
        onClearRoute={(id) => void saveFields(id, { map_geometry: null })}
        onIconChange={(id, icon: MapIconType) => void saveFields(id, { map_icon: icon })}
      />
    </div>
  )
}
