import type { ProjectSector } from '@/lib/supabase/types'
import type { MapIconType } from '@/lib/map/constants'
import { isMapIconType } from '@/lib/map/constants'
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
}

export const SECTOR_LINE_COLOR: Record<ProjectSector, string> = {
  government: '#2563eb',
  infrastructure: '#f59e0b',
  real_estate: '#059669',
  prefab: '#7c3aed',
  institutional: '#64748b',
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
  const puck = SECTOR_PUCK[project.sector] ?? 'bg-slate-500'

  const el = document.createElement('div')
  // z-10 while hovered/selected so the label isn't buried under sibling markers
  el.className = 'group cursor-pointer select-none hover:z-10 data-[selected=true]:z-10'
  // Stamped so MapView's diff can detect a stale glyph and rebuild
  el.dataset.icon = icon
  el.dataset.sector = project.sector
  const valueLine =
    project.estimated_value != null
      ? `<div class="tnum text-[11px] leading-tight text-muted-foreground">${formatValue(project.estimated_value)}</div>`
      : ''
  el.innerHTML = `
    <div class="relative flex flex-col items-center transition-transform duration-150 group-hover:scale-110 group-data-[selected=true]:scale-125">
      <div class="pointer-events-none absolute bottom-full mb-1.5 max-w-52 rounded-md border border-border bg-card px-2 py-1 text-center opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-data-[map-labels=true]/maplabels:opacity-100">
        <div class="truncate text-xs font-medium leading-tight text-foreground">${escapeHtml(project.name)}</div>
        ${valueLine}
      </div>
      <div class="flex size-9 items-center justify-center rounded-full ${puck} text-white ring-2 ring-white shadow-md dark:ring-slate-900 group-data-[selected=true]:ring-[3px]">
        ${glyphSvg(icon, 18)}
      </div>
      <div class="-mt-[3px] size-2 rotate-45 ${puck} rounded-[1px] shadow-md"></div>
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
