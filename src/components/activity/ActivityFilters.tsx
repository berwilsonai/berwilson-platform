'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'

const TABLE_OPTIONS = [
  { value: 'projects', label: 'Projects' },
  { value: 'updates', label: 'Updates' },
  { value: 'documents', label: 'Documents' },
  { value: 'milestones', label: 'Milestones' },
  { value: 'dd_items', label: 'Diligence Items' },
  { value: 'financing_structures', label: 'Financing' },
  { value: 'compliance_items', label: 'Compliance' },
  { value: 'review_queue', label: 'Review Queue' },
  { value: 'parties', label: 'Parties' },
]

const ACTOR_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'ai', label: 'AI' },
  { value: 'system', label: 'System' },
]

interface ActivityFiltersProps {
  projects: Array<{ id: string; name: string }>
  project: string
  table: string
  actorType: string
  from: string
  to: string
}

export default function ActivityFilters({
  projects,
  project,
  table,
  actorType,
  from,
  to,
}: ActivityFiltersProps) {
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
      params.delete('page')
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const hasFilters = project || table || actorType || from || to

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={project}
        onChange={(e) => setParam('project', e.target.value)}
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
        value={table}
        onChange={(e) => setParam('table', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Tables</option>
        {TABLE_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <select
        value={actorType}
        onChange={(e) => setParam('actor_type', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Actors</option>
        {ACTOR_OPTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={from}
        onChange={(e) => setParam('from', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <input
        type="date"
        value={to}
        onChange={(e) => setParam('to', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

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
