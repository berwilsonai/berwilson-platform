'use client'

import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { formatValue } from '@/lib/utils/constants'
import type { MapProject } from '@/lib/map/types'
import { MarkerGlyph, iconForProject } from './markers'

interface MapSearchProps {
  /** Placed projects only — picking one flies to it. */
  projects: MapProject[]
  onPick: (id: string) => void
}

export default function MapSearch({ projects, onPick }: MapSearchProps) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    return projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          (p.location ?? '').toLowerCase().includes(term) ||
          (p.client_entity ?? '').toLowerCase().includes(term)
      )
      .slice(0, 8)
  }, [projects, q])

  const open = focused && matches.length > 0

  function pick(id: string) {
    onPick(id)
    setQ('')
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && matches.length > 0) {
      e.preventDefault()
      pick(matches[Math.min(hi, matches.length - 1)].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setQ('')
      inputRef.current?.blur()
    }
  }

  return (
    <div className="relative">
      <div className="flex h-9 w-44 items-center gap-1.5 rounded-lg border border-border bg-card px-2 shadow-sm elev-1">
        <Search size={13} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setHi(0)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder="Find a project…"
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-md elev-2">
          {matches.map((p, i) => (
            <button
              key={p.id}
              // mousedown, not click — fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault()
                pick(p.id)
              }}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                i === hi ? 'bg-accent' : ''
              }`}
            >
              <MarkerGlyph icon={iconForProject(p)} sector={p.sector} size={10} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{p.name}</span>
                {p.location && (
                  <span className="block truncate text-muted-foreground">{p.location}</span>
                )}
              </span>
              {p.estimated_value != null && (
                <span className="tnum shrink-0 text-muted-foreground">
                  {formatValue(p.estimated_value)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
