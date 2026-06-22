'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FILTER_STORAGE_KEY = 'bw.projects.filters'
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

  // On first load, re-apply the last-used filters if the user landed here with
  // no filters in the URL. Persisted per browser, so each person keeps their
  // own view (e.g. sales vs operations) across sessions.
  const appliedRef = useRef(false)
  useEffect(() => {
    if (appliedRef.current) return
    appliedRef.current = true
    if (sector || status || stage) return
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY)
      if (!raw) return
      const f = JSON.parse(raw) as { sector?: string; status?: string; stage?: string }
      const params = new URLSearchParams()
      if (f.sector) params.set('sector', f.sector)
      if (f.status) params.set('status', f.status)
      if (f.stage) params.set('stage', f.stage)
      const qs = params.toString()
      if (qs) router.replace(`${pathname}?${qs}`)
    } catch {
      /* ignore */
    }
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function persist(next: { sector: string; status: string; stage: string }) {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      persist({
        sector: params.get('sector') ?? '',
        status: params.get('status') ?? '',
        stage: params.get('stage') ?? '',
      })
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const hasFilters = sector || status || stage

  function clearAll() {
    persist({ sector: '', status: '', stage: '' })
    router.push(pathname)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Sector */}
      <select
        value={sector}
        onChange={(e) => setParam('sector', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="h-8 flex items-center gap-1 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  )
}
