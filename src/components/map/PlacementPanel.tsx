'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, MapPin, Search } from 'lucide-react'
import type { MapProject } from '@/lib/map/types'
import { MarkerGlyph, iconForProject } from './markers'

interface PlacementPanelProps {
  unplaced: MapProject[]
  placedCount: number
  total: number
  onStartPlace: (id: string) => void
}

export default function PlacementPanel({
  unplaced,
  placedCount,
  total,
  onStartPlace,
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
              <button
                key={p.id}
                onClick={() => onStartPlace(p.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
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
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
