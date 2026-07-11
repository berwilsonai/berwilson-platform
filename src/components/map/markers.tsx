import type { ProjectSector } from '@/lib/supabase/types'
import type { MapIconType } from '@/lib/map/constants'
import { isMapIconType, projectPhase } from '@/lib/map/constants'
import { formatValue } from '@/lib/utils/constants'
import type { MapProject } from '@/lib/map/types'

// Illustrated map markers: a sector-tinted puck with a type-specific glyph.
// DOM markers (maplibregl.Marker) get buildMarkerElement(); React surfaces
// (legend, sheet, placement list) use <MarkerGlyph />. Both render the same
// stroke-style SVG paths so the visual language matches everywhere.

// Lucide-style 24x24 stroke glyphs (stroke=currentColor, no fill)
const ICON_PATHS: Record<MapIconType, string> = {
  data_center:
    '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/><path d="M11 7.5h2"/><path d="M11 16.5h2"/>',
  rail:
    '<path d="M8 3h8a4 4 0 0 1 4 4v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4z"/><path d="M4 11h16"/><path d="M8.5 15.5h.01"/><path d="M15.5 15.5h.01"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  hospital:
    '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  housing:
    '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  power:
    '<path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z"/>',
  industrial:
    '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  government:
    '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="m12 2 8 5H4z"/>',
  office:
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M4 22h16"/><path d="M10 6h1"/><path d="M13 6h1"/><path d="M10 10h1"/><path d="M13 10h1"/><path d="M10 14h1"/><path d="M13 14h1"/><path d="M10 22v-4h4v4"/>',
  water:
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  default:
    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/>',
}

// Sector hue families match SECTOR_BADGE (src/lib/utils/constants.ts) so the
// map speaks the same color language as the rest of the app. Literal class
// strings so the Tailwind scanner picks them up.
const SECTOR_PUCK: Record<ProjectSector, string> = {
  government: 'bg-blue-600',
  infrastructure: 'bg-amber-500',
  real_estate: 'bg-emerald-600',
  prefab: 'bg-violet-600',
  institutional: 'bg-slate-500',
  technology: 'bg-sky-600',
  health: 'bg-rose-600',
}

// Outlined (pipeline) variant: card-colored puck, sector-colored ring + glyph
const SECTOR_OUTLINE: Record<ProjectSector, string> = {
  government: 'text-blue-600 ring-blue-600 dark:text-blue-400 dark:ring-blue-400',
  infrastructure: 'text-amber-500 ring-amber-500 dark:text-amber-400 dark:ring-amber-400',
  real_estate: 'text-emerald-600 ring-emerald-600 dark:text-emerald-400 dark:ring-emerald-400',
  prefab: 'text-violet-600 ring-violet-600 dark:text-violet-400 dark:ring-violet-400',
  institutional: 'text-slate-500 ring-slate-500 dark:text-slate-400 dark:ring-slate-400',
  technology: 'text-sky-600 ring-sky-600 dark:text-sky-400 dark:ring-sky-400',
  health: 'text-rose-600 ring-rose-600 dark:text-rose-400 dark:ring-rose-400',
}

export const SECTOR_LINE_COLOR: Record<ProjectSector, string> = {
  government: '#2563eb',
  infrastructure: '#f59e0b',
  real_estate: '#059669',
  prefab: '#7c3aed',
  institutional: '#64748b',
  technology: '#0284c7',
  health: '#e11d48',
}

// Value-scaled markers, calibrated to the real portfolio: most projects land
// between $100M and a few $B, so that's where the tiers spread. The xl tier
// (≥$10B) is the mega-programs — bigger puck, pulsing halo, always-labeled.
type MarkerTier = 'sm' | 'md' | 'lg' | 'xl'

function markerTier(value: number | null | undefined): MarkerTier {
  if (value == null) return 'md'
  if (value >= 10_000_000_000) return 'xl'
  if (value >= 1_000_000_000) return 'lg'
  if (value >= 100_000_000) return 'md'
  return 'sm'
}

const TIER_STYLE: Record<MarkerTier, { puck: string; glyph: number; tip: string }> = {
  sm: { puck: 'size-7', glyph: 14, tip: 'size-1.5' },
  md: { puck: 'size-9', glyph: 18, tip: 'size-2' },
  lg: { puck: 'size-11', glyph: 22, tip: 'size-2.5' },
  xl: { puck: 'size-13', glyph: 26, tip: 'size-3' },
}

/** Stamped onto marker elements so MapView's diff can detect stale styling. */
export function markerVariant(p: Pick<MapProject, 'stage' | 'estimated_value'>): string {
  return `${projectPhase(p.stage)}:${markerTier(p.estimated_value)}`
}

export function iconForProject(project: Pick<MapProject, 'map_icon' | 'sector'>): MapIconType {
  if (isMapIconType(project.map_icon)) return project.map_icon
  switch (project.sector) {
    case 'government':
      return 'government'
    case 'infrastructure':
      return 'industrial'
    case 'real_estate':
      return 'housing'
    case 'prefab':
      return 'industrial'
    case 'institutional':
      return 'office'
    case 'technology':
      return 'data_center'
    case 'health':
      return 'hospital'
    default:
      return 'default'
  }
}

function glyphSvg(icon: MapIconType, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[icon]}</svg>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * DOM element for a maplibregl.Marker (anchor: 'bottom').
 *
 * The name/value label shows on hover, and stays on for every marker once the
 * map container (named group `maplabels` in MapView) carries
 * data-map-labels="true" — MapView toggles that above LABEL_ZOOM.
 */
export function buildMarkerElement(project: MapProject): HTMLDivElement {
  const icon = iconForProject(project)
  const solid = SECTOR_PUCK[project.sector] ?? 'bg-slate-500'
  const tierKey = markerTier(project.estimated_value)
  const tier = TIER_STYLE[tierKey]
  // Awarded work = solid sector puck; pipeline = outlined (card bg, sector ring)
  const awarded = projectPhase(project.stage) === 'awarded'
  const puckStyle = awarded
    ? `${solid} text-white ring-white dark:ring-slate-900`
    : `bg-card ${SECTOR_OUTLINE[project.sector] ?? 'text-slate-500 ring-slate-500'}`

  const el = document.createElement('div')
  // z-10 while hovered/selected so the label isn't buried under sibling markers
  el.className = 'group cursor-pointer select-none hover:z-10 data-[selected=true]:z-10'
  // Stamped so MapView's diff can detect a stale glyph/style and rebuild
  el.dataset.icon = icon
  el.dataset.sector = project.sector
  el.dataset.variant = markerVariant(project)
  const valueLine =
    project.estimated_value != null
      ? `<div class="tnum text-[11px] leading-tight text-muted-foreground">${formatValue(project.estimated_value)}</div>`
      : ''
  // Mega-programs: pulsing sector-colored halo + label that never hides
  const halo =
    tierKey === 'xl'
      ? `<span class="absolute inset-0 animate-ping rounded-full ${solid} opacity-30 [animation-duration:3s]"></span>`
      : ''
  const labelVisibility =
    tierKey === 'xl'
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-data-[map-labels=true]/maplabels:opacity-100'
  el.innerHTML = `
    <div class="relative flex flex-col items-center transition-transform duration-150 group-hover:scale-110 group-data-[selected=true]:scale-125">
      <div class="pointer-events-none absolute bottom-full mb-1.5 max-w-52 rounded-md border border-border bg-card px-2 py-1 text-center ${labelVisibility} shadow-md transition-opacity duration-150">
        <div class="truncate text-xs font-medium leading-tight text-foreground">${escapeHtml(project.name)}</div>
        ${valueLine}
      </div>
      <div class="relative flex ${tier.puck} items-center justify-center rounded-full ${puckStyle} ring-2 shadow-md group-data-[selected=true]:ring-[3px]">
        ${halo}
        ${glyphSvg(icon, tier.glyph)}
      </div>
      <div class="-mt-[3px] ${tier.tip} rotate-45 ${solid} rounded-[1px] shadow-md"></div>
    </div>`
  return el
}

/**
 * Cluster puck for overlapping markers at low zoom: count badge, sector color
 * when the members are homogeneous, neutral slate otherwise. Sized by combined
 * value (not just count) and labeled with the total, so a cluster that
 * swallows a big program still tells the story.
 */
export function buildClusterElement(members: MapProject[]): HTMLDivElement {
  const count = members.length
  const total = members.reduce((s, m) => s + (m.estimated_value ?? 0), 0)
  const sectors = new Set(members.map((m) => m.sector))
  const puck =
    sectors.size === 1 ? SECTOR_PUCK[members[0].sector] ?? 'bg-slate-700' : 'bg-slate-700'
  const size =
    total >= 10_000_000_000
      ? 'size-12 text-sm'
      : total >= 1_000_000_000 || count >= 10
        ? 'size-11 text-sm'
        : count >= 5
          ? 'size-10 text-sm'
          : 'size-9 text-xs'
  const valueLabel =
    total > 0
      ? `<div class="tnum mt-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium leading-tight text-foreground shadow-md">${formatValue(total)}</div>`
      : ''

  const el = document.createElement('div')
  el.className = 'cursor-pointer select-none hover:z-10'
  el.title = members.map((m) => m.name).join('\n')
  el.innerHTML = `
    <div class="flex flex-col items-center transition-transform duration-150 hover:scale-110">
      <div class="flex ${size} items-center justify-center rounded-full ${puck} font-semibold text-white ring-2 ring-white shadow-md dark:ring-slate-900">
        ${count}
      </div>
      ${valueLabel}
    </div>`
  return el
}

export function setMarkerSelected(el: HTMLElement, selected: boolean) {
  if (selected) el.dataset.selected = 'true'
  else delete el.dataset.selected
}

/** React version of the marker glyph for legend / sheet / placement list. */
export function MarkerGlyph({
  icon,
  sector,
  size = 16,
  className = '',
}: {
  icon: MapIconType
  sector: ProjectSector
  size?: number
  className?: string
}) {
  const puck = SECTOR_PUCK[sector] ?? 'bg-slate-500'
  const box = Math.round(size * 1.9)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-white ${puck} ${className}`}
      style={{ width: box, height: box }}
      dangerouslySetInnerHTML={{ __html: glyphSvg(icon, size) }}
    />
  )
}
