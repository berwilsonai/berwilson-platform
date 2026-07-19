'use client'

import { useRouter } from 'next/navigation'
import { Network, Pencil, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStoredState } from '@/hooks/use-stored-state'
import OrgStructureChart from '@/components/company/OrgStructureChart'
import OrgStructureBoard from '@/components/company/OrgStructureBoard'
import type { OrgNode, OrgPerson } from '@/lib/supabase/types'

/**
 * Chart | Edit switcher for /company/structure. Chart is the presentation
 * surface (drill-down, present mode, PDF export); the board is the data-entry
 * surface. The choice persists per device. Switching triggers a
 * router.refresh() so chart props pick up any edits made on the board.
 */
export default function StructureView({
  nodes,
  people,
  canEdit,
}: {
  nodes: OrgNode[]
  people: OrgPerson[]
  canEdit: boolean
}) {
  const [view, setView] = useStoredState<'chart' | 'board'>('bw.org.view', 'chart')
  const router = useRouter()

  function switchTo(v: 'chart' | 'board') {
    if (v === view) return
    setView(v)
    router.refresh()
  }

  const tabs = [
    { value: 'chart' as const, label: 'Chart', icon: Network },
    { value: 'board' as const, label: canEdit ? 'Edit' : 'Details', icon: canEdit ? Pencil : Eye },
  ]

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
        {tabs.map((tab, i) => (
          <button
            key={tab.value}
            onClick={() => switchTo(tab.value)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-8 transition-colors',
              i > 0 && 'border-l border-border',
              view === tab.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'chart' ? (
        <OrgStructureChart nodes={nodes} people={people} />
      ) : (
        <div className="max-w-3xl">
          <OrgStructureBoard initialNodes={nodes} initialPeople={people} canEdit={canEdit} />
        </div>
      )}
    </div>
  )
}
