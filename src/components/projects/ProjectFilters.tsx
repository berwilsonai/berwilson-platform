'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'

import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGES } from '@/lib/utils/stages'
import type { ProjectSector, ProjectStatus, ProjectStage } from '@/lib/supabase/types'

const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'won', 'lost', 'closed']
const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}
const SECTORS: ProjectSector[] = ['government', 'infrastructure', 'real_estate', 'prefab', 'institutional']

interface ProjectFiltersProps {
  sector: string
  status: string
  stage: string
}

export default function ProjectFilters({ sector, status, stage }: ProjectFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /*
   * ⚠ THE localStorage REPLAY IS GONE, AND IT WAS A BUG, NOT A CONVENIENCE.
   *
   * This used to mirror the URL filters into localStorage and then, on mount,
   * replay them into the URL whenever someone arrived with none. Two
   * consequences, both bad for a two-person company that sends each other
   * links: a bare `/projects` rendered DIFFERENTLY for each executive, and the
   * sender could not tell — and because the replay ran after hydration, the
   * list visibly re-rendered under the reader on every arrival.
   *
   * §12 is explicit on both halves: a filter kept outside the URL is not a
   * view, and a localStorage copy of something that lives in the database is
   * not a cache — it is the only copy that page can see. The URL *is* the view,
   * so a bare link must mean a bare view. Anyone who wants their own default
   * can bookmark the filtered URL, which is also shareable.
   *
   * Removing it also drops one of the 11 `set-state-in-effect` lint warnings
   * recorded in §9.
   */

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const hasFilters = sector || status || stage

  function clearAll() {
    router.push(pathname)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Sector */}
      <select
        value={sector}
        onChange={(e) => setParam('sector', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">All Sectors</option>
        {SECTORS.map((s) => (
          <option key={s} value={s}>
            {SECTOR_LABELS[s]}
          </option>
        ))}
      </select>

      {/* Status */}
      <select
        value={status}
        onChange={(e) => setParam('status', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">All Statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      {/* Stage */}
      <select
        value={stage}
        onChange={(e) => setParam('stage', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">All Stages</option>
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s as ProjectStage]}
          </option>
        ))}
      </select>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="h-9 flex items-center gap-1 px-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  )
}
