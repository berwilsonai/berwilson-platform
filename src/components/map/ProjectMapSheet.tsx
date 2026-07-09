'use client'

import Link from 'next/link'
import { ArrowUpRight, Crosshair, MapPin, Route, Trash2 } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  SECTOR_LABELS,
  SECTOR_BADGE,
  STAGE_LABELS,
  STAGE_BADGE,
  STATUS_LABELS,
  STATUS_BADGE,
  formatValue,
  formatDate,
  weightedValue,
} from '@/lib/utils/constants'
import { MAP_ICON_TYPES, MAP_ICON_LABELS, type MapIconType } from '@/lib/map/constants'
import type { MapProject } from '@/lib/map/types'
import { MarkerGlyph, iconForProject } from './markers'

interface ProjectMapSheetProps {
  project: MapProject | null
  photoUrls: string[]
  isAdmin: boolean
  onClose: () => void
  onReposition: (id: string) => void
  onDrawRoute: (id: string) => void
  onClearRoute: (id: string) => void
  onIconChange: (id: string, icon: MapIconType) => void
}

function chip(classes: string, label: string, key?: string) {
  return (
    <span
      key={key ?? label}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classes}`}
    >
      {label}
    </span>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
    {children}
  </div>
)

export default function ProjectMapSheet({
  project,
  photoUrls,
  isAdmin,
  onClose,
  onReposition,
  onDrawRoute,
  onClearRoute,
  onIconChange,
}: ProjectMapSheetProps) {
  const p = project

  const dates: [string, string | null][] = p
    ? [
        ['Bid due', p.bid_due_date],
        ['Award', p.award_date],
        ['NTP', p.ntp_date],
        ['Completion', p.substantial_completion_date],
      ]
    : []
  const shownDates = dates.filter(([, v]) => v)
  const weighted = p ? weightedValue(p.estimated_value, p.win_probability) : 0

  return (
    <Sheet open={!!p} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {p && (
          <>
            {/* Photos */}
            {photoUrls.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto px-4 pt-12">
                {photoUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt={p.name}
                    className="h-36 w-auto shrink-0 rounded-lg border border-border object-cover"
                  />
                ))}
              </div>
            ) : (
              <div className="mx-4 mt-12 flex h-24 items-center justify-center rounded-lg border border-border bg-muted/40">
                <MarkerGlyph icon={iconForProject(p)} sector={p.sector} size={22} />
              </div>
            )}

            <SheetHeader className="gap-2">
              <SheetTitle className="leading-snug">{p.name}</SheetTitle>
              <div className="flex flex-wrap gap-1.5">
                {chip(SECTOR_BADGE[p.sector], SECTOR_LABELS[p.sector])}
                {p.stage && chip(STAGE_BADGE[p.stage], STAGE_LABELS[p.stage])}
                {p.status && chip(STATUS_BADGE[p.status], STATUS_LABELS[p.status])}
              </div>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-4">
              {/* Value */}
              <div className="rounded-xl border border-border bg-card p-3 elev-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <SectionLabel>Estimated Value</SectionLabel>
                    <div className="tnum mt-0.5 text-xl font-semibold">
                      {formatValue(p.estimated_value)}
                    </div>
                  </div>
                  {p.win_probability != null && (
                    <div className="text-right">
                      <SectionLabel>Weighted ({p.win_probability}%)</SectionLabel>
                      <div className="tnum mt-0.5 text-xl font-semibold text-muted-foreground">
                        {formatValue(weighted)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Facts */}
              <div className="space-y-2 text-sm">
                {p.client_entity && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Client</span>
                    <span className="text-right font-medium">{p.client_entity}</span>
                  </div>
                )}
                {p.location && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Location</span>
                    <span className="text-right font-medium">{p.location}</span>
                  </div>
                )}
                {p.delivery_method && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Delivery</span>
                    <span className="text-right font-medium">{p.delivery_method}</span>
                  </div>
                )}
              </div>

              {/* Description */}
              {p.description && (
                <div className="space-y-1.5">
                  <SectionLabel>About</SectionLabel>
                  <p className="text-sm leading-relaxed text-foreground/90">{p.description}</p>
                </div>
              )}

              {/* Dates */}
              {shownDates.length > 0 && (
                <div className="space-y-1.5">
                  <SectionLabel>Key Dates</SectionLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {shownDates.map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-border bg-card px-2.5 py-1.5">
                        <div className="text-[11px] text-muted-foreground">{label}</div>
                        <div className="tnum text-sm font-medium">{formatDate(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Link
                href={`/projects/${p.id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open project
                <ArrowUpRight size={14} />
              </Link>

              {/* Admin map controls */}
              {isAdmin && (
                <div className="space-y-2.5 border-t border-border pt-4">
                  <SectionLabel>Map Placement</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onReposition(p.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Crosshair size={14} />
                      Reposition
                    </button>
                    <button
                      onClick={() => onDrawRoute(p.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Route size={14} />
                      {p.map_geometry ? 'Redraw route' : 'Draw route'}
                    </button>
                    {p.map_geometry && (
                      <button
                        onClick={() => onClearRoute(p.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-red-600"
                      >
                        <Trash2 size={14} />
                        Remove route
                      </button>
                    )}
                  </div>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <MapPin size={14} />
                      Marker style
                    </span>
                    <select
                      value={iconForProject(p)}
                      onChange={(e) => onIconChange(p.id, e.target.value as MapIconType)}
                      className="h-8 rounded-md border border-border bg-card px-2 text-xs"
                    >
                      {MAP_ICON_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {MAP_ICON_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
