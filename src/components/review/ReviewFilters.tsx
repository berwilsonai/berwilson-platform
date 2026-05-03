'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'

const REASON_LABELS: Record<string, string> = {
  low_confidence: 'Low Confidence',
  ambiguous_project: 'Ambiguous Project',
  unknown_party: 'Unknown Party',
  conflicting_data: 'Conflicting Data',
}
const REASONS = Object.keys(REASON_LABELS)

interface FilterProject {
  id: string
  name: string
}

interface ReviewFiltersProps {
  projects: FilterProject[]
  projectId: string
  reason: string
  showResolved: boolean
}

export default function ReviewFilters({ projects, projectId, reason, showResolved }: ReviewFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

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

  const hasFilters = projectId || reason

  function toggleResolved() {
    const params = new URLSearchParams(searchParams.toString())
    if (showResolved) {
      params.delete('show_resolved')
    } else {
      params.set('show_resolved', '1')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={projectId}
        onChange={(e) => setParam('project_id', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={reason}
        onChange={(e) => setParam('reason', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Reasons</option>
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {REASON_LABELS[r]}
          </option>
        ))}
      </select>

      <button
        onClick={toggleResolved}
        className={`h-8 flex items-center gap-1 px-2.5 rounded-md text-xs font-medium transition-colors ${
          showResolved
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        {showResolved ? 'Hide Resolved' : 'Show Resolved'}
      </button>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="h-8 flex items-center gap-1 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  )
}
