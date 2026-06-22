import { Gauge } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import CapacityBoard, { type CapacityOwner, type CapacityPursuit } from '@/components/capacity/CapacityBoard'
import { weightedValue } from '@/lib/utils/constants'
import type { ProjectStage } from '@/lib/supabase/types'

export const metadata = { title: 'Capacity — Ber Wilson Intelligence' }

interface ActionItem {
  text?: string
  assignee?: string
  completed?: boolean
}

const UNASSIGNED = 'Unassigned'

export default async function CapacityPage() {
  const supabase = createAdminClient()

  const [{ data: projects }, { data: updates }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, stage, estimated_value, capture_lead, win_probability, bid_due_date')
      .in('status', ['active', 'on_hold'])
      .order('name'),
    supabase
      .from('updates')
      .select('action_items')
      .eq('review_state', 'approved'),
  ])

  // Count open tasks per assignee (case-insensitive)
  const openTasksByOwner = new Map<string, number>()
  for (const u of updates ?? []) {
    const items = Array.isArray(u.action_items) ? (u.action_items as unknown as ActionItem[]) : []
    for (const item of items) {
      if (item.completed) continue
      const key = (item.assignee ?? '').trim().toLowerCase()
      if (!key) continue
      openTasksByOwner.set(key, (openTasksByOwner.get(key) ?? 0) + 1)
    }
  }

  // Group pursuits by capture_lead
  const ownerMap = new Map<string, CapacityOwner>()
  function ensureOwner(name: string, isUnassigned: boolean): CapacityOwner {
    const key = name.toLowerCase()
    let o = ownerMap.get(key)
    if (!o) {
      o = { name, isUnassigned, pursuits: [], totalValue: 0, weightedValue: 0, openTasks: 0 }
      ownerMap.set(key, o)
    }
    return o
  }

  for (const p of projects ?? []) {
    const proj = p as typeof p & { capture_lead?: string | null; win_probability?: number | null; bid_due_date?: string | null }
    const lead = (proj.capture_lead ?? '').trim()
    const owner = ensureOwner(lead || UNASSIGNED, !lead)
    const weighted = weightedValue(p.estimated_value, proj.win_probability ?? null)
    const pursuit: CapacityPursuit = {
      id: p.id,
      name: p.name,
      stage: (p.stage ?? 'pursuit') as ProjectStage,
      estimatedValue: p.estimated_value,
      weighted,
      bidDue: proj.bid_due_date ?? null,
    }
    owner.pursuits.push(pursuit)
    owner.totalValue += p.estimated_value ?? 0
    owner.weightedValue += weighted
  }

  // Attach open-task counts; sort each owner's pursuits by soonest bid due
  for (const owner of ownerMap.values()) {
    owner.openTasks = openTasksByOwner.get(owner.name.toLowerCase()) ?? 0
    owner.pursuits.sort((a, b) => {
      if (a.bidDue && b.bidDue) return a.bidDue.localeCompare(b.bidDue)
      if (a.bidDue) return -1
      if (b.bidDue) return 1
      return (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0)
    })
  }

  // Real owners first (by pipeline value desc), Unassigned last
  const owners = [...ownerMap.values()].sort((a, b) => {
    if (a.isUnassigned) return 1
    if (b.isUnassigned) return -1
    return b.totalValue - a.totalValue
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Gauge size={18} className="text-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Capacity</h1>
          <p className="text-xs text-muted-foreground">
            Pursuit load and open tasks by capture lead — see who&rsquo;s carrying what.
          </p>
        </div>
      </div>
      <CapacityBoard owners={owners} />
    </div>
  )
}
