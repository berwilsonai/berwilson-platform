'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, MapPin, Route, Search, Wand2 } from 'lucide-react'
import type { MapProject } from '@/lib/map/types'
import { MarkerGlyph, iconForProject } from './markers'

interface PlacementPanelProps {
  unplaced: MapProject[]
  placedCount: number
  total: number
  onStartPlace: (id: string) => void
  onStartDraw: (id: string) => void
  onAutoPlace: (id: string) => void
  onAutoPlaceAll: () => void
  autoPlacing: boolean
}

export default function PlacementPanel({
  unplaced,
  placedCount,
  total,
  onStartPlace,
  onStartDraw,
  onAutoPlace,
  onAutoPlaceAll,
  autoPlacing,
}: PlacementPanelProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  if (unplaced.length === 0) return null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? unplaced.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.location ?? '').toLowerCase().includes(q)
      )
    : unplaced
  const withLocation = unplaced.filter((p) => p.location?.trim()).length

  return (
    <div className="absolute bottom-4 left-4 z-10 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg elev-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="inline-flex items-center gap-2">
          <MapPin size={14} className="text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Place Projects
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="tnum text-xs text-muted-foreground">
            {placedCount} of {total} placed
          </span>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          {withLocation > 0 && (
            <div className="border-b border-border p-2">
              <button
                onClick={onAutoPlaceAll}
                disabled={autoPlacing}
                title="Look up each project's location text (offline city/ZIP lookup) and drop pins at the matched centers — reposition any afterwards"
                className="inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                {autoPlacing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wand2 size={13} />
                )}
                Auto-place {withLocation} from location{withLocation === 1 ? '' : 's'}
              </button>
            </div>
          )}
          <div className="relative border-b border-border">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a project…"
              className="h-8 w-full bg-transparent pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">No matches.</div>
            )}
            {filtered.map((p) => (
              <div
                key={p.id}
                className="group flex w-full items-center gap-1 pr-2 transition-colors hover:bg-accent"
              >
                <button
                  onClick={() => onStartPlace(p.id)}
                  title="Click, then click the map to place a marker"
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
                >
                  <MarkerGlyph icon={iconForProject(p)} sector={p.sector} size={12} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    {p.location && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.location}
                      </span>
                    )}
                  </span>
                </button>
                {p.location?.trim() && (
                  <button
                    onClick={() => onAutoPlace(p.id)}
                    disabled={autoPlacing}
                    title={`Place from “${p.location}” (offline lookup)`}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 disabled:opacity-40 group-hover:opacity-100"
                  >
                    <Wand2 size={14} />
                  </button>
                )}
                <button
                  onClick={() => onStartDraw(p.id)}
                  title="Draw a route instead of a marker (rail corridors)"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Route size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
