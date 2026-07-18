'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { FileDown, Maximize2, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import OrgChart from '@/components/company/OrgChart'
import type { OrgNode, OrgPerson } from '@/lib/supabase/types'

/**
 * Interactive presentation chart: depth presets + per-division drill-down,
 * zoom, fullscreen Present mode, and the PDF export link. Renders purely from
 * props (no data copy) so a router.refresh() after board edits flows through.
 */

type Depth = 'high' | 'entities' | 'full'

interface OrgStructureChartProps {
  nodes: OrgNode[]
  people: OrgPerson[]
}

const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25]

// Faint diagram-canvas dot grid; the dots derive from the theme border color
// so they track light/dark automatically.
const DOT_GRID: CSSProperties = {
  backgroundImage:
    'radial-gradient(color-mix(in oklab, var(--border) 60%, transparent) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
}

export default function OrgStructureChart({ nodes, people }: OrgStructureChartProps) {
  const divisionIds = useMemo(
    () => nodes.filter((n) => n.kind === 'division').map((n) => n.id),
    [nodes],
  )

  // Start high-level: the audience sees arms + divisions, then you drill.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [showPeople, setShowPeople] = useState(false)
  const [zoomIdx, setZoomIdx] = useState(4) // 100%
  const [present, setPresent] = useState(false)

  // Esc leaves Present mode.
  useEffect(() => {
    if (!present) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresent(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [present])

  const allExpanded = divisionIds.length > 0 && divisionIds.every((id) => expanded.has(id))
  const depth: Depth | null =
    expanded.size === 0 && !showPeople
      ? 'high'
      : allExpanded && !showPeople
        ? 'entities'
        : allExpanded && showPeople
          ? 'full'
          : null

  function applyDepth(d: Depth) {
    setExpanded(d === 'high' ? new Set() : new Set(divisionIds))
    setShowPeople(d === 'full')
  }

  function toggleDivision(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const zoom = ZOOM_STEPS[zoomIdx]

  const controls = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Depth presets */}
      <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
        {(
          [
            { value: 'high', label: 'High level' },
            { value: 'entities', label: 'Entities' },
            { value: 'full', label: 'Everything' },
          ] as { value: Depth; label: string }[]
        ).map((opt, i) => (
          <button
            key={opt.value}
            onClick={() => applyDepth(opt.value)}
            className={cn(
              'px-3 h-8 transition-colors',
              i > 0 && 'border-l border-border',
              depth === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Zoom */}
      <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
        <button
          onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}
          disabled={zoomIdx === 0}
          className="inline-flex items-center justify-center size-8 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
          aria-label="Zoom out"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => setZoomIdx(4)}
          className="px-1.5 h-8 border-x border-border text-xs text-muted-foreground hover:text-foreground tnum"
          aria-label="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
          disabled={zoomIdx === ZOOM_STEPS.length - 1}
          className="inline-flex items-center justify-center size-8 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
          aria-label="Zoom in"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/company/structure/print"
          target="_blank"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          <FileDown size={14} /> Export PDF
        </Link>
        {present ? (
          <button
            onClick={() => setPresent(false)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <X size={14} /> Exit
          </button>
        ) : (
          <button
            onClick={() => {
              setPresent(true)
              // Presenting on a big screen — nudge to 110% if still at default.
              setZoomIdx((z) => (z === 4 ? 5 : z))
            }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            <Maximize2 size={14} /> Present
          </button>
        )}
      </div>
    </div>
  )

  const chart = (
    <div style={{ zoom }}>
      <OrgChart
        nodes={nodes}
        people={people}
        expandedDivisions={expanded}
        showPeople={showPeople}
        onToggleDivision={toggleDivision}
      />
    </div>
  )

  if (present) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-auto">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-3">
          {controls}
        </div>
        <div className="min-h-[calc(100vh-3.6rem)] px-8 py-10" style={DOT_GRID}>
          {/* Slide title */}
          <div className="text-center mb-10">
            <p className="label-caps text-muted-foreground">Ber Wilson</p>
            <h1 className="text-3xl font-semibold tracking-tight mt-1">Entity Architecture</h1>
          </div>
          <div className="overflow-x-auto pb-4">{chart}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {controls}
      {/* Diagram canvas */}
      <div className="rounded-xl border border-border bg-card elev-1 overflow-hidden">
        <div className="overflow-x-auto p-6" style={DOT_GRID}>
          {chart}
        </div>
      </div>
    </div>
  )
}
