'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Plus,
  X,
  Loader2,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Building2,
  Landmark,
  Users,
  Info,
  Network,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import EmptyState from '@/components/shared/EmptyState'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ORG_ENTITY_TYPES,
  ORG_ENTITY_TYPE_LABELS,
  ORG_ENTITY_TYPE_SHORT,
  ORG_ENTITY_BADGE,
  ORG_TIERS,
  ORG_TIER_LABELS,
  orgEntityType,
  type OrgTier,
} from '@/lib/utils/org'
import type { OrgNode, OrgPerson } from '@/lib/supabase/types'
import { handleAuthError } from '@/components/tasks/task-utils'

interface OrgStructureBoardProps {
  initialNodes: OrgNode[]
  initialPeople: OrgPerson[]
  canEdit: boolean
}

const fieldClass =
  'h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

const OPEN_BADGE =
  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'

type DeleteTarget =
  | { type: 'node'; id: string; title: string; description: string }
  | { type: 'person'; id: string; title: string; description?: string }

export default function OrgStructureBoard({ initialNodes, initialPeople, canEdit }: OrgStructureBoardProps) {
  const [nodes, setNodes] = useState<OrgNode[]>(initialNodes)
  const [people, setPeople] = useState<OrgPerson[]>(initialPeople)

  // Roster drag state (leadership/director lists)
  const [personDragId, setPersonDragId] = useState<string | null>(null)
  const [personDrop, setPersonDrop] = useState<{ tier: OrgTier; index: number } | null>(null)
  const prePersonDragRef = useRef<OrgPerson[]>(initialPeople)

  // SPV drag state (scoped to its division)
  const [spvDragId, setSpvDragId] = useState<string | null>(null)
  const [spvDrop, setSpvDrop] = useState<{ divisionId: string; index: number } | null>(null)
  const preNodeDragRef = useRef<OrgNode[]>(initialNodes)

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  // ── Derived structure ──────────────────────────────────────────────────────

  const bySort = (a: { sort_order: number; created_at: string | null }, b: { sort_order: number; created_at: string | null }) =>
    a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? '')

  const arms = useMemo(() => nodes.filter((n) => n.kind === 'arm').sort(bySort), [nodes])
  const management = useMemo(() => nodes.find((n) => n.kind === 'management') ?? null, [nodes])
  const divisions = useMemo(() => nodes.filter((n) => n.kind === 'division').sort(bySort), [nodes])

  const spvsByDivision = useMemo(() => {
    const map = new Map<string, OrgNode[]>()
    for (const d of divisions) map.set(d.id, [])
    for (const n of nodes) {
      if (n.kind !== 'spv' || !n.parent_id) continue
      const list = map.get(n.parent_id)
      if (list) list.push(n)
    }
    for (const list of map.values()) list.sort(bySort)
    return map
  }, [nodes, divisions])

  const roster = useMemo(() => {
    const map: Record<OrgTier, OrgPerson[]> = { leadership: [], director: [] }
    for (const p of people) {
      if (p.node_id) continue
      map[p.tier === 'leadership' ? 'leadership' : 'director'].push(p)
    }
    map.leadership.sort(bySort)
    map.director.sort(bySort)
    return map
  }, [people])

  const staffByNode = useMemo(() => {
    const map = new Map<string, OrgPerson[]>()
    for (const p of people) {
      if (!p.node_id) continue
      const list = map.get(p.node_id) ?? []
      list.push(p)
      map.set(p.node_id, list)
    }
    for (const list of map.values()) list.sort(bySort)
    return map
  }, [people])

  const spvCount = nodes.filter((n) => n.kind === 'spv').length

  // ── CRUD helpers ───────────────────────────────────────────────────────────

  async function createNode(input: Record<string, unknown>): Promise<OrgNode | null> {
    const res = await fetch('/api/org/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (handleAuthError(res)) return null
    if (!res.ok) throw new Error()
    const data = await res.json()
    setNodes((prev) => [...prev, data.node])
    return data.node as OrgNode
  }

  async function patchNode(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const prev = nodes
    setNodes((p) =>
      p.map((n) => (n.id === id ? ({ ...n, ...patch } as OrgNode) : n)),
    )
    try {
      const res = await fetch(`/api/org/nodes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (handleAuthError(res)) return false
      if (!res.ok) throw new Error()
      return true
    } catch {
      setNodes(prev)
      toast.error('Failed to save changes')
      return false
    }
  }

  async function createPerson(input: Record<string, unknown>): Promise<OrgPerson | null> {
    const res = await fetch('/api/org/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (handleAuthError(res)) return null
    if (!res.ok) throw new Error()
    const data = await res.json()
    setPeople((prev) => [...prev, data.person])
    return data.person as OrgPerson
  }

  async function patchPerson(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const prev = people
    setPeople((p) =>
      p.map((row) => (row.id === id ? ({ ...row, ...patch } as OrgPerson) : row)),
    )
    try {
      const res = await fetch(`/api/org/people/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (handleAuthError(res)) return false
      if (!res.ok) throw new Error()
      return true
    } catch {
      setPeople(prev)
      toast.error('Failed to save changes')
      return false
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    const prevNodes = nodes
    const prevPeople = people
    if (target.type === 'node') {
      // Mirror the FK cascade locally: the node, its child SPVs, and any staff
      // allocated to the removed subtree.
      const removed = new Set<string>([target.id])
      for (const n of nodes) {
        if (n.parent_id && removed.has(n.parent_id)) removed.add(n.id)
      }
      setNodes((p) => p.filter((n) => !removed.has(n.id)))
      setPeople((p) => p.filter((row) => !row.node_id || !removed.has(row.node_id)))
    } else {
      setPeople((p) => p.filter((row) => row.id !== target.id))
    }
    try {
      const res = await fetch(
        target.type === 'node' ? `/api/org/nodes/${target.id}` : `/api/org/people/${target.id}`,
        { method: 'DELETE' },
      )
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      toast.success('Removed')
    } catch {
      setNodes(prevNodes)
      setPeople(prevPeople)
      toast.error('Failed to remove')
    } finally {
      setDeleteTarget(null)
    }
  }

  // ── Reorder: roster people ─────────────────────────────────────────────────

  async function commitPeopleMove(next: OrgPerson[], snapshot: OrgPerson[], affected: Set<OrgTier>) {
    setPeople(next)
    const items = next
      .filter((p) => !p.node_id && affected.has(p.tier === 'leadership' ? 'leadership' : 'director'))
      .map((p) => ({
        id: p.id,
        sort_order: p.sort_order,
        tier: (p.tier === 'leadership' ? 'leadership' : 'director') as OrgTier,
      }))
    try {
      const res = await fetch('/api/org/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ people: items }),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
    } catch {
      setPeople(snapshot)
      toast.error('Failed to save the new order')
    }
  }

  function movePerson(id: string, tier: OrgTier, index: number, snapshot: OrgPerson[]) {
    const moved = people.find((p) => p.id === id)
    if (!moved || moved.node_id) return
    const from: OrgTier = moved.tier === 'leadership' ? 'leadership' : 'director'

    const lists: Record<OrgTier, OrgPerson[]> = {
      leadership: [...roster.leadership],
      director: [...roster.director],
    }

    const fromIdx = lists[from].findIndex((p) => p.id === id)
    if (fromIdx === -1) return
    lists[from].splice(fromIdx, 1)

    let insertAt = index
    if (from === tier && fromIdx < index) insertAt -= 1
    insertAt = Math.max(0, Math.min(insertAt, lists[tier].length))
    lists[tier].splice(insertAt, 0, { ...moved, tier })

    const affected = new Set<OrgTier>([from, tier])
    const repositioned = new Map<string, { tier: OrgTier; sort_order: number }>()
    for (const t of affected) {
      lists[t].forEach((p, i) => repositioned.set(p.id, { tier: t, sort_order: i }))
    }

    const next = people.map((p) => {
      const pos = repositioned.get(p.id)
      return pos ? { ...p, tier: pos.tier, sort_order: pos.sort_order } : p
    })
    commitPeopleMove(next, snapshot, affected)
  }

  function handlePersonDrop() {
    if (personDragId && personDrop) {
      movePerson(personDragId, personDrop.tier, personDrop.index, prePersonDragRef.current)
    }
    setPersonDragId(null)
    setPersonDrop(null)
  }

  // ── Reorder: SPVs within a division / divisions themselves ────────────────

  async function commitNodeOrder(next: OrgNode[], snapshot: OrgNode[], items: { id: string; sort_order: number }[]) {
    setNodes(next)
    try {
      const res = await fetch('/api/org/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: items }),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
    } catch {
      setNodes(snapshot)
      toast.error('Failed to save the new order')
    }
  }

  function moveSpv(id: string, index: number, snapshot: OrgNode[]) {
    const moved = nodes.find((n) => n.id === id)
    if (!moved?.parent_id) return
    const list = [...(spvsByDivision.get(moved.parent_id) ?? [])]

    const fromIdx = list.findIndex((n) => n.id === id)
    if (fromIdx === -1) return
    list.splice(fromIdx, 1)

    let insertAt = index
    if (fromIdx < index) insertAt -= 1
    insertAt = Math.max(0, Math.min(insertAt, list.length))
    list.splice(insertAt, 0, moved)

    const repositioned = new Map<string, number>()
    list.forEach((n, i) => repositioned.set(n.id, i))

    const next = nodes.map((n) => {
      const pos = repositioned.get(n.id)
      return pos !== undefined ? { ...n, sort_order: pos } : n
    })
    commitNodeOrder(
      next,
      snapshot,
      list.map((n, i) => ({ id: n.id, sort_order: i })),
    )
  }

  function handleSpvDrop() {
    if (spvDragId && spvDrop) {
      moveSpv(spvDragId, spvDrop.index, preNodeDragRef.current)
    }
    setSpvDragId(null)
    setSpvDrop(null)
  }

  function moveDivision(id: string, dir: 'up' | 'down') {
    const idx = divisions.findIndex((d) => d.id === id)
    const to = dir === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || to < 0 || to >= divisions.length) return
    const list = [...divisions]
    const [moved] = list.splice(idx, 1)
    list.splice(to, 0, moved)
    const repositioned = new Map<string, number>()
    list.forEach((n, i) => repositioned.set(n.id, i))
    const next = nodes.map((n) => {
      const pos = repositioned.get(n.id)
      return pos !== undefined ? { ...n, sort_order: pos } : n
    })
    commitNodeOrder(next, nodes, list.map((n, i) => ({ id: n.id, sort_order: i })))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No structure yet"
        description={
          canEdit
            ? 'The entity architecture is empty. Make sure the org_structure migration (and its seed) has been applied.'
            : 'The entity architecture has not been set up yet.'
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryStat label="Entities" value={nodes.length} />
        <SummaryStat label="Divisions" value={divisions.length} />
        <SummaryStat label="SPVs" value={spvCount} />
        <SummaryStat label="People" value={people.length} />
      </div>

      {/* Arms */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {arms.map((arm, i) => (
          <ArmCard key={arm.id} arm={arm} icon={i === 0 ? Building2 : Landmark} canEdit={canEdit} onSave={(patch) => patchNode(arm.id, patch)} />
        ))}
      </div>

      {/* Management services note */}
      {management && (
        <ManagementNote node={management} canEdit={canEdit} onSave={(patch) => patchNode(management.id, patch)} />
      )}

      {/* Leadership roster */}
      <LeadershipPanel
        roster={roster}
        canEdit={canEdit}
        dragId={personDragId}
        drop={personDrop}
        onDragStart={(id) => {
          prePersonDragRef.current = people
          setPersonDragId(id)
        }}
        onDragEnd={() => {
          setPersonDragId(null)
          setPersonDrop(null)
        }}
        onDragOver={(tier, index) => setPersonDrop({ tier, index })}
        onDrop={handlePersonDrop}
        onMoveStep={(p, tier, idx, dir) =>
          movePerson(p.id, tier, dir === 'up' ? idx - 1 : idx + 2, people)
        }
        onMoveToTier={(p, tier) => movePerson(p.id, tier, roster[tier].length, people)}
        onAdd={(input) => createPerson(input)}
        onSave={(id, patch) => patchPerson(id, patch)}
        onDelete={(p) =>
          setDeleteTarget({
            type: 'person',
            id: p.id,
            title: p.status === 'open' ? 'Remove open position?' : `Remove ${p.name}?`,
            description: `${p.role} will be removed from the chart.`,
          })
        }
      />

      {/* Divisions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="label-caps text-muted-foreground">Divisions</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        {divisions.map((division, idx) => (
          <DivisionPanel
            key={division.id}
            division={division}
            index={idx}
            divisionCount={divisions.length}
            spvs={spvsByDivision.get(division.id) ?? []}
            staffByNode={staffByNode}
            canEdit={canEdit}
            spvDragId={spvDragId}
            spvDrop={spvDrop}
            onSpvDragStart={(id) => {
              preNodeDragRef.current = nodes
              setSpvDragId(id)
            }}
            onSpvDragEnd={() => {
              setSpvDragId(null)
              setSpvDrop(null)
            }}
            onSpvDragOver={(index) => setSpvDrop({ divisionId: division.id, index })}
            onSpvDrop={handleSpvDrop}
            onSpvMoveStep={(spv, idx2, dir) => moveSpv(spv.id, dir === 'up' ? idx2 - 1 : idx2 + 2, nodes)}
            onMoveDivision={(dir) => moveDivision(division.id, dir)}
            onSaveNode={(id, patch) => patchNode(id, patch)}
            onAddSpv={(input) => createNode(input)}
            onAddPerson={(input) => createPerson(input)}
            onSavePerson={(id, patch) => patchPerson(id, patch)}
            onDeleteNode={(node) =>
              setDeleteTarget({
                type: 'node',
                id: node.id,
                title: `Delete ${node.name}?`,
                description:
                  node.kind === 'division'
                    ? 'This removes the division AND every SPV and person under it.'
                    : 'This removes the SPV and any staff assigned to it.',
              })
            }
            onDeletePerson={(p) =>
              setDeleteTarget({
                type: 'person',
                id: p.id,
                title: `Remove ${p.name ?? p.role}?`,
                description: `${p.role} will be removed from the chart.`,
              })
            }
          />
        ))}
        {canEdit && <AddDivisionForm onAdd={(input) => createNode({ ...input, kind: 'division', sort_order: divisions.length })} />}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget?.title ?? 'Remove?'}
        description={deleteTarget?.description}
        confirmLabel="Remove"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ─── Summary stat ─────────────────────────────────────────────────────────────

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <Panel className="px-4 py-3">
      <p className="text-lg font-semibold tnum leading-tight">{value}</p>
      <p className="label-caps text-muted-foreground mt-0.5">{label}</p>
    </Panel>
  )
}

// ─── Arms ─────────────────────────────────────────────────────────────────────

function ArmCard({
  arm,
  icon: Icon,
  canEdit,
  onSave,
}: {
  arm: OrgNode
  icon: typeof Building2
  canEdit: boolean
  onSave: (patch: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(arm.name)
  const [entityType, setEntityType] = useState(arm.entity_type ?? '')
  const [note, setNote] = useState(arm.note ?? '')

  if (editing) {
    return (
      <Panel className="p-3.5 space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Entity name" autoFocus className={cn(fieldClass, 'w-full font-medium')} />
        <input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="Entity type (e.g. Wyoming C-Corporation)" className={cn(fieldClass, 'w-full')} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" rows={2} className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        <FormActions
          onCancel={() => {
            setEditing(false)
            setName(arm.name)
            setEntityType(arm.entity_type ?? '')
            setNote(arm.note ?? '')
          }}
          onSave={async () => {
            if (!name.trim()) return
            const ok = await onSave({ name: name.trim(), entity_type: entityType, note })
            if (ok) setEditing(false)
          }}
          disabled={!name.trim()}
        />
      </Panel>
    )
  }

  return (
    <Panel className="p-3.5">
      <div className="flex items-start gap-2.5">
        <Icon size={18} className="text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{arm.name}</p>
          {arm.entity_type && <Chip className="mt-1">{arm.entity_type}</Chip>}
          {arm.note && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{arm.note}</p>}
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={`Edit ${arm.name}`}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
    </Panel>
  )
}

// ─── Management services note ─────────────────────────────────────────────────

function ManagementNote({
  node,
  canEdit,
  onSave,
}: {
  node: OrgNode
  canEdit: boolean
  onSave: (patch: Record<string, unknown>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(node.name)
  const [note, setNote] = useState(node.note ?? '')

  if (editing) {
    return (
      <div className="rounded-md bg-muted/30 p-3 space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Entity name" autoFocus className={cn(fieldClass, 'w-full font-medium')} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Employment / liability-wall note" rows={3} className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        <FormActions
          onCancel={() => {
            setEditing(false)
            setName(node.name)
            setNote(node.note ?? '')
          }}
          onSave={async () => {
            if (!name.trim()) return
            const ok = await onSave({ name: name.trim(), note })
            if (ok) setEditing(false)
          }}
          disabled={!name.trim()}
        />
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5 rounded-md bg-muted/30 px-3 py-2.5">
      <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{node.name}</p>
        {node.note && <p className="text-xs text-muted-foreground leading-snug mt-0.5">{node.note}</p>}
      </div>
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Edit management note"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  )
}

// ─── Leadership roster ────────────────────────────────────────────────────────

interface LeadershipPanelProps {
  roster: Record<OrgTier, OrgPerson[]>
  canEdit: boolean
  dragId: string | null
  drop: { tier: OrgTier; index: number } | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (tier: OrgTier, index: number) => void
  onDrop: () => void
  onMoveStep: (p: OrgPerson, tier: OrgTier, idx: number, dir: 'up' | 'down') => void
  onMoveToTier: (p: OrgPerson, tier: OrgTier) => void
  onAdd: (input: Record<string, unknown>) => Promise<OrgPerson | null>
  onSave: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onDelete: (p: OrgPerson) => void
}

function LeadershipPanel({
  roster, canEdit, dragId, drop,
  onDragStart, onDragEnd, onDragOver, onDrop,
  onMoveStep, onMoveToTier, onAdd, onSave, onDelete,
}: LeadershipPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const total = roster.leadership.length + roster.director.length

  return (
    <Panel>
      <PanelHeader label={<span className="inline-flex items-center gap-1.5"><Users size={13} /> Leadership</span>} count={total}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={collapsed ? 'Expand leadership' : 'Collapse leadership'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
      </PanelHeader>
      {!collapsed && (
        <div className="px-4 pb-4 pt-3 space-y-4">
          {ORG_TIERS.map((tier) => {
            const list = roster[tier]
            return (
              <div
                key={tier}
                onDragOver={
                  canEdit
                    ? (e) => {
                        e.preventDefault()
                        onDragOver(tier, list.length)
                      }
                    : undefined
                }
                onDrop={
                  canEdit
                    ? (e) => {
                        e.preventDefault()
                        onDrop()
                      }
                    : undefined
                }
              >
                <p className="label-caps text-muted-foreground mb-1.5">{ORG_TIER_LABELS[tier]}</p>
                {list.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-1">None yet</p>
                )}
                <div className="space-y-1">
                  {list.map((person, idx) => (
                    <div key={person.id}>
                      {dragId && drop?.tier === tier && drop.index === idx && dragId !== person.id && (
                        <div className="h-0.5 rounded-full bg-primary mb-1" />
                      )}
                      {editingId === person.id ? (
                        <PersonEditForm
                          person={person}
                          showTier
                          onCancel={() => setEditingId(null)}
                          onSave={async (patch) => {
                            const ok = await onSave(person.id, patch)
                            if (ok) setEditingId(null)
                          }}
                        />
                      ) : (
                        <PersonRow
                          person={person}
                          canEdit={canEdit}
                          dragging={dragId === person.id}
                          menuOpen={menuId === person.id}
                          onDragStart={() => {
                            setMenuId(null)
                            setEditingId(null)
                            onDragStart(person.id)
                          }}
                          onDragEnd={onDragEnd}
                          onDragOverRow={(before) => onDragOver(tier, before ? idx : idx + 1)}
                          onDrop={onDrop}
                          onToggleMenu={() => setMenuId((m) => (m === person.id ? null : person.id))}
                          onCloseMenu={() => setMenuId(null)}
                          menu={
                            <>
                              <MenuItem icon={ArrowUp} label="Move up" disabled={idx === 0} onClick={() => { setMenuId(null); onMoveStep(person, tier, idx, 'up') }} />
                              <MenuItem icon={ArrowDown} label="Move down" disabled={idx === list.length - 1} onClick={() => { setMenuId(null); onMoveStep(person, tier, idx, 'down') }} />
                              <div className="my-1 border-t border-border" />
                              <MenuItem
                                icon={Users}
                                label={`Move to ${ORG_TIER_LABELS[tier === 'leadership' ? 'director' : 'leadership']}`}
                                onClick={() => { setMenuId(null); onMoveToTier(person, tier === 'leadership' ? 'director' : 'leadership') }}
                              />
                              <div className="my-1 border-t border-border" />
                              <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuId(null); setEditingId(person.id) }} />
                              <MenuItem icon={Trash2} label="Remove" destructive onClick={() => { setMenuId(null); onDelete(person) }} />
                            </>
                          }
                        />
                      )}
                    </div>
                  ))}
                  {dragId && drop?.tier === tier && drop.index >= list.length && (
                    <div className="h-0.5 rounded-full bg-primary" />
                  )}
                </div>
              </div>
            )
          })}

          {canEdit &&
            (adding ? (
              <AddPersonForm
                showTier
                onCancel={() => setAdding(false)}
                onAdd={async (input) => {
                  const tier = (input.tier as OrgTier) ?? 'director'
                  const created = await onAdd({ ...input, sort_order: roster[tier].length })
                  if (created) setAdding(false)
                }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus size={14} /> Add person
              </button>
            ))}
        </div>
      )}
    </Panel>
  )
}

// ─── Person row ───────────────────────────────────────────────────────────────

function PersonRow({
  person,
  canEdit,
  dragging,
  menuOpen,
  menu,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDrop,
  onToggleMenu,
  onCloseMenu,
}: {
  person: OrgPerson
  canEdit: boolean
  dragging: boolean
  menuOpen: boolean
  menu: ReactNode
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverRow: (before: boolean) => void
  onDrop: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
}) {
  const isOpen = person.status === 'open'
  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? onDragStart : undefined}
      onDragEnd={canEdit ? onDragEnd : undefined}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onDragOverRow(e.clientY < rect.top + rect.height / 2)
            }
          : undefined
      }
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onDrop()
            }
          : undefined
      }
      className={cn(
        'group relative flex items-start gap-2 rounded-md px-2 py-1.5 -mx-2 transition-colors',
        canEdit && 'cursor-grab active:cursor-grabbing hover:bg-muted/50',
        dragging && 'opacity-40',
      )}
    >
      <div className="min-w-0 flex-1">
        {isOpen ? (
          <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
            <span>{person.role}</span>
            <Chip tone={OPEN_BADGE}>Open</Chip>
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">{person.name}</p>
            <p className="text-xs text-muted-foreground">{person.role}</p>
          </>
        )}
        {person.detail && <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">{person.detail}</p>}
      </div>
      {canEdit && (
        <div className="shrink-0 flex items-center gap-0.5">
          <GripVertical size={13} className="hidden md:block text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors mt-1" />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleMenu()
            }}
            className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Person actions"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      )}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={(e) => {
              e.stopPropagation()
              onCloseMenu()
            }}
          />
          <div className="absolute right-1 top-8 z-30 w-52 rounded-lg border border-border bg-card py-1 elev-3" onClick={(e) => e.stopPropagation()}>
            {menu}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Person forms ─────────────────────────────────────────────────────────────

function AddPersonForm({
  showTier,
  onCancel,
  onAdd,
}: {
  showTier: boolean
  onCancel: () => void
  onAdd: (input: Record<string, unknown>) => Promise<void>
}) {
  const [isOpenRole, setIsOpenRole] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [tier, setTier] = useState<OrgTier>('director')
  const [busy, setBusy] = useState(false)

  const valid = role.trim().length > 0 && (isOpenRole || name.trim().length > 0)

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onAdd({
        name: isOpenRole ? undefined : name.trim(),
        role: role.trim(),
        status: isOpenRole ? 'open' : 'active',
        ...(showTier ? { tier } : {}),
      })
    } catch {
      toast.error('Failed to add')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md bg-muted/30 p-3 space-y-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={isOpenRole} onChange={(e) => setIsOpenRole(e.target.checked)} />
        Open position (not yet filled)
      </label>
      {!isOpenRole && (
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus className={cn(fieldClass, 'w-full')} />
      )}
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role / title" className={cn(fieldClass, 'w-full')} />
      {showTier && (
        <select value={tier} onChange={(e) => setTier(e.target.value as OrgTier)} className={cn(fieldClass, 'w-full')}>
          {ORG_TIERS.map((t) => (
            <option key={t} value={t}>
              {ORG_TIER_LABELS[t]}
            </option>
          ))}
        </select>
      )}
      <FormActions onCancel={onCancel} onSave={submit} disabled={!valid} busy={busy} saveLabel="Add" />
    </div>
  )
}

function PersonEditForm({
  person,
  showTier,
  onCancel,
  onSave,
}: {
  person: OrgPerson
  showTier: boolean
  onCancel: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [isOpenRole, setIsOpenRole] = useState(person.status === 'open')
  const [name, setName] = useState(person.name ?? '')
  const [role, setRole] = useState(person.role)
  const [detail, setDetail] = useState(person.detail ?? '')
  const [tier, setTier] = useState<OrgTier>(person.tier === 'leadership' ? 'leadership' : 'director')
  const [busy, setBusy] = useState(false)

  const valid = role.trim().length > 0 && (isOpenRole || name.trim().length > 0)

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onSave({
        name: isOpenRole ? '' : name.trim(),
        role: role.trim(),
        detail,
        status: isOpenRole ? 'open' : 'active',
        ...(showTier ? { tier } : {}),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md bg-muted/30 p-3 space-y-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={isOpenRole} onChange={(e) => setIsOpenRole(e.target.checked)} />
        Open position (not yet filled)
      </label>
      {!isOpenRole && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus className={cn(fieldClass, 'w-full')} />}
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role / title" className={cn(fieldClass, 'w-full')} />
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Detail — responsibilities, scope…"
        rows={2}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
      />
      {showTier && (
        <select value={tier} onChange={(e) => setTier(e.target.value as OrgTier)} className={cn(fieldClass, 'w-full')}>
          {ORG_TIERS.map((t) => (
            <option key={t} value={t}>
              {ORG_TIER_LABELS[t]}
            </option>
          ))}
        </select>
      )}
      <FormActions onCancel={onCancel} onSave={submit} disabled={!valid} busy={busy} />
    </div>
  )
}

// ─── Division panel ───────────────────────────────────────────────────────────

interface DivisionPanelProps {
  division: OrgNode
  index: number
  divisionCount: number
  spvs: OrgNode[]
  staffByNode: Map<string, OrgPerson[]>
  canEdit: boolean
  spvDragId: string | null
  spvDrop: { divisionId: string; index: number } | null
  onSpvDragStart: (id: string) => void
  onSpvDragEnd: () => void
  onSpvDragOver: (index: number) => void
  onSpvDrop: () => void
  onSpvMoveStep: (spv: OrgNode, idx: number, dir: 'up' | 'down') => void
  onMoveDivision: (dir: 'up' | 'down') => void
  onSaveNode: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onAddSpv: (input: Record<string, unknown>) => Promise<OrgNode | null>
  onAddPerson: (input: Record<string, unknown>) => Promise<OrgPerson | null>
  onSavePerson: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onDeleteNode: (node: OrgNode) => void
  onDeletePerson: (p: OrgPerson) => void
}

function DivisionPanel({
  division, index, divisionCount, spvs, staffByNode, canEdit,
  spvDragId, spvDrop,
  onSpvDragStart, onSpvDragEnd, onSpvDragOver, onSpvDrop, onSpvMoveStep,
  onMoveDivision, onSaveNode, onAddSpv, onAddPerson, onSavePerson,
  onDeleteNode, onDeletePerson,
}: DivisionPanelProps) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [addingSpv, setAddingSpv] = useState(false)
  const staff = staffByNode.get(division.id) ?? []
  const entityType = orgEntityType(division.entity_type)
  // SPV drags are scoped to their own division: only the source division
  // registers drop targets, so a cross-division drop can't happen.
  const draggingFromHere = !!spvDragId && spvs.some((s) => s.id === spvDragId)
  const dropHere = draggingFromHere && spvDrop?.divisionId === division.id

  return (
    <Panel>
      {/* Header */}
      <div className="relative flex items-start gap-2 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left">
          {division.vertical && <p className="label-caps text-muted-foreground">{division.vertical}</p>}
          <p className="text-sm font-semibold leading-tight mt-0.5">{division.name}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
            {entityType && <Chip tone={ORG_ENTITY_BADGE[entityType]}>{ORG_ENTITY_TYPE_SHORT[entityType]}</Chip>}
            <span className="tnum">
              {spvs.length} SPV{spvs.length !== 1 ? 's' : ''}
              {staff.length > 0 && ` · ${staff.length} staff`}
            </span>
          </p>
        </button>
        <div className="shrink-0 flex items-center gap-0.5 mt-0.5">
          {canEdit && (
            <button
              onClick={() => setMenuOpen((m) => !m)}
              className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Division actions"
            >
              <MoreHorizontal size={15} />
            </button>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={open ? 'Collapse division' : 'Expand division'}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-3 top-11 z-30 w-44 rounded-lg border border-border bg-card py-1 elev-3">
              <MenuItem icon={ArrowUp} label="Move up" disabled={index === 0} onClick={() => { setMenuOpen(false); onMoveDivision('up') }} />
              <MenuItem icon={ArrowDown} label="Move down" disabled={index === divisionCount - 1} onClick={() => { setMenuOpen(false); onMoveDivision('down') }} />
              <div className="my-1 border-t border-border" />
              <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuOpen(false); setEditing(true); setOpen(true) }} />
              <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { setMenuOpen(false); onDeleteNode(division) }} />
            </div>
          </>
        )}
      </div>

      {(open || editing) && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {editing && (
            <NodeEditForm
              node={division}
              showVertical
              onCancel={() => setEditing(false)}
              onSave={async (patch) => {
                const ok = await onSaveNode(division.id, patch)
                if (ok) setEditing(false)
              }}
            />
          )}

          {/* Division staff */}
          <StaffSection
            nodeId={division.id}
            label="Division staff"
            staff={staff}
            canEdit={canEdit}
            onAddPerson={onAddPerson}
            onSavePerson={onSavePerson}
            onDeletePerson={onDeletePerson}
          />

          {/* SPVs */}
          <div
            className="space-y-2"
            onDragOver={
              canEdit && draggingFromHere
                ? (e) => {
                    e.preventDefault()
                    onSpvDragOver(spvs.length)
                  }
                : undefined
            }
            onDrop={
              canEdit && draggingFromHere
                ? (e) => {
                    e.preventDefault()
                    onSpvDrop()
                  }
                : undefined
            }
          >
            <p className="label-caps text-muted-foreground">SPVs</p>
            {spvs.length === 0 && !addingSpv && (
              <p className="text-xs text-muted-foreground italic">No SPVs yet</p>
            )}
            {spvs.map((spv, idx) => (
              <div key={spv.id}>
                {dropHere && spvDrop?.index === idx && spvDragId !== spv.id && (
                  <div className="h-0.5 rounded-full bg-primary mb-2" />
                )}
                <SpvCard
                  spv={spv}
                  index={idx}
                  listLength={spvs.length}
                  staff={staffByNode.get(spv.id) ?? []}
                  canEdit={canEdit}
                  dragging={spvDragId === spv.id}
                  onDragStart={() => onSpvDragStart(spv.id)}
                  onDragEnd={onSpvDragEnd}
                  onDragOverCard={(before) => {
                    if (draggingFromHere) onSpvDragOver(before ? idx : idx + 1)
                  }}
                  onDrop={onSpvDrop}
                  onMoveStep={(dir) => onSpvMoveStep(spv, idx, dir)}
                  onSaveNode={onSaveNode}
                  onAddPerson={onAddPerson}
                  onSavePerson={onSavePerson}
                  onDeleteNode={onDeleteNode}
                  onDeletePerson={onDeletePerson}
                />
              </div>
            ))}
            {dropHere && spvDrop !== null && spvDrop.index >= spvs.length && (
              <div className="h-0.5 rounded-full bg-primary" />
            )}
            {canEdit &&
              (addingSpv ? (
                <AddSpvForm
                  onCancel={() => setAddingSpv(false)}
                  onAdd={async (input) => {
                    const created = await onAddSpv({
                      ...input,
                      kind: 'spv',
                      parent_id: division.id,
                      sort_order: spvs.length,
                    })
                    if (created) setAddingSpv(false)
                  }}
                />
              ) : (
                <button
                  onClick={() => setAddingSpv(true)}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus size={14} /> Add SPV
                </button>
              ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ─── SPV card ─────────────────────────────────────────────────────────────────

function SpvCard({
  spv, index, listLength, staff, canEdit, dragging,
  onDragStart, onDragEnd, onDragOverCard, onDrop, onMoveStep,
  onSaveNode, onAddPerson, onSavePerson, onDeleteNode, onDeletePerson,
}: {
  spv: OrgNode
  index: number
  listLength: number
  staff: OrgPerson[]
  canEdit: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverCard: (before: boolean) => void
  onDrop: () => void
  onMoveStep: (dir: 'up' | 'down') => void
  onSaveNode: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onAddPerson: (input: Record<string, unknown>) => Promise<OrgPerson | null>
  onSavePerson: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onDeleteNode: (node: OrgNode) => void
  onDeletePerson: (p: OrgPerson) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const entityType = orgEntityType(spv.entity_type)

  if (editing) {
    return (
      <NodeEditForm
        node={spv}
        showLocation
        onCancel={() => setEditing(false)}
        onSave={async (patch) => {
          const ok = await onSaveNode(spv.id, patch)
          if (ok) setEditing(false)
        }}
      />
    )
  }

  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? onDragStart : undefined}
      onDragEnd={canEdit ? onDragEnd : undefined}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              onDragOverCard(e.clientY < rect.top + rect.height / 2)
            }
          : undefined
      }
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onDrop()
            }
          : undefined
      }
      className={cn(
        'group relative rounded-md bg-muted/30',
        canEdit && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="flex-1 min-w-0 text-left flex items-center gap-2">
          {open ? (
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
          )}
          <span className="min-w-0">
            <span className="text-sm font-medium">{spv.name}</span>
            <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {entityType && (
                <Chip tone={ORG_ENTITY_BADGE[entityType]} title={ORG_ENTITY_TYPE_LABELS[entityType]}>
                  {ORG_ENTITY_TYPE_SHORT[entityType]}
                </Chip>
              )}
              <span className="text-xs text-muted-foreground">
                {spv.location ? `${spv.location} · ` : ''}
                <span className="tnum">{staff.length}</span> staff
              </span>
            </span>
          </span>
        </button>
        {canEdit && (
          <div className="shrink-0 flex items-center gap-0.5">
            <GripVertical size={13} className="hidden md:block text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((m) => !m)
              }}
              className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="SPV actions"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        )}
      </div>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-9 z-30 w-44 rounded-lg border border-border bg-card py-1 elev-3">
            <MenuItem icon={ArrowUp} label="Move up" disabled={index === 0} onClick={() => { setMenuOpen(false); onMoveStep('up') }} />
            <MenuItem icon={ArrowDown} label="Move down" disabled={index === listLength - 1} onClick={() => { setMenuOpen(false); onMoveStep('down') }} />
            <div className="my-1 border-t border-border" />
            <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenuOpen(false); setEditing(true) }} />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={() => { setMenuOpen(false); onDeleteNode(spv) }} />
          </div>
        </>
      )}
      {open && (
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          <StaffSection
            nodeId={spv.id}
            label="Staff"
            staff={staff}
            canEdit={canEdit}
            onAddPerson={onAddPerson}
            onSavePerson={onSavePerson}
            onDeletePerson={onDeletePerson}
          />
        </div>
      )}
    </div>
  )
}

// ─── Staff (division- or SPV-level people) ────────────────────────────────────

function StaffSection({
  nodeId,
  label,
  staff,
  canEdit,
  onAddPerson,
  onSavePerson,
  onDeletePerson,
}: {
  nodeId: string
  label: string
  staff: OrgPerson[]
  canEdit: boolean
  onAddPerson: (input: Record<string, unknown>) => Promise<OrgPerson | null>
  onSavePerson: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onDeletePerson: (p: OrgPerson) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div>
      <p className="label-caps text-muted-foreground mb-1.5">{label}</p>
      {staff.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic">None assigned yet</p>
      )}
      <div className="space-y-1">
        {staff.map((person) =>
          editingId === person.id ? (
            <PersonEditForm
              key={person.id}
              person={person}
              showTier={false}
              onCancel={() => setEditingId(null)}
              onSave={async (patch) => {
                const ok = await onSavePerson(person.id, patch)
                if (ok) setEditingId(null)
              }}
            />
          ) : (
            <div key={person.id} className="group/staff flex items-start justify-between gap-2 py-1">
              <div className="min-w-0">
                <p className="text-sm">
                  {person.status === 'open' ? (
                    <span className="inline-flex items-center gap-1.5">
                      {person.role} <Chip tone={OPEN_BADGE}>Open</Chip>
                    </span>
                  ) : (
                    person.name
                  )}
                </p>
                {person.status !== 'open' && (
                  <p className="text-xs text-muted-foreground">{person.role}</p>
                )}
                {person.detail && (
                  <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">{person.detail}</p>
                )}
              </div>
              {canEdit && (
                <div className="shrink-0 flex items-center gap-0.5">
                  <button
                    onClick={() => setEditingId(person.id)}
                    className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
                    aria-label={`Edit ${person.name ?? person.role}`}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => onDeletePerson(person)}
                    className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground/60 hover:bg-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    aria-label={`Remove ${person.name ?? person.role}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          ),
        )}
      </div>
      {canEdit &&
        (adding ? (
          <div className="mt-1.5">
            <AddPersonForm
              showTier={false}
              onCancel={() => setAdding(false)}
              onAdd={async (input) => {
                const created = await onAddPerson({ ...input, node_id: nodeId, sort_order: staff.length })
                if (created) setAdding(false)
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus size={12} /> Add person
          </button>
        ))}
    </div>
  )
}

// ─── Node forms ───────────────────────────────────────────────────────────────

function NodeEditForm({
  node,
  showVertical = false,
  showLocation = false,
  onCancel,
  onSave,
}: {
  node: OrgNode
  showVertical?: boolean
  showLocation?: boolean
  onCancel: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState(node.name)
  const [vertical, setVertical] = useState(node.vertical ?? '')
  const [location, setLocation] = useState(node.location ?? '')
  const [entityType, setEntityType] = useState(orgEntityType(node.entity_type) ?? 'series')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        entity_type: entityType,
        ...(showVertical ? { vertical } : {}),
        ...(showLocation ? { location } : {}),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md bg-muted/30 p-3 space-y-2">
      {showVertical && (
        <input value={vertical} onChange={(e) => setVertical(e.target.value)} placeholder="Vertical (e.g. Energy)" className={cn(fieldClass, 'w-full')} />
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Entity name" autoFocus className={cn(fieldClass, 'w-full font-medium')} />
      {showLocation && (
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className={cn(fieldClass, 'w-full')} />
      )}
      <select value={entityType} onChange={(e) => setEntityType(e.target.value as typeof entityType)} className={cn(fieldClass, 'w-full')}>
        {ORG_ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {ORG_ENTITY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <FormActions onCancel={onCancel} onSave={submit} disabled={!name.trim()} busy={busy} />
    </div>
  )
}

function AddSpvForm({
  onCancel,
  onAdd,
}: {
  onCancel: () => void
  onAdd: (input: Record<string, unknown>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [entityType, setEntityType] = useState('series')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onAdd({ name: name.trim(), location, entity_type: entityType })
    } catch {
      toast.error('Failed to add SPV')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md bg-muted/30 p-3 space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="SPV name" autoFocus className={cn(fieldClass, 'w-full')} />
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className={cn(fieldClass, 'w-full')} />
      <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={cn(fieldClass, 'w-full')}>
        {ORG_ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {ORG_ENTITY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <FormActions onCancel={onCancel} onSave={submit} disabled={!name.trim()} busy={busy} saveLabel="Add SPV" />
    </div>
  )
}

function AddDivisionForm({ onAdd }: { onAdd: (input: Record<string, unknown>) => Promise<OrgNode | null> }) {
  const [adding, setAdding] = useState(false)
  const [vertical, setVertical] = useState('')
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('series')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const created = await onAdd({ name: name.trim(), vertical, entity_type: entityType })
      if (created) {
        setAdding(false)
        setVertical('')
        setName('')
        setEntityType('series')
      }
    } catch {
      toast.error('Failed to add division')
    } finally {
      setBusy(false)
    }
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={14} /> Add division
      </button>
    )
  }

  return (
    <Panel className="p-3 space-y-2">
      <input value={vertical} onChange={(e) => setVertical(e.target.value)} placeholder="Vertical (e.g. Energy)" autoFocus className={cn(fieldClass, 'w-full')} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Holdings LLC name" className={cn(fieldClass, 'w-full')} />
      <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={cn(fieldClass, 'w-full')}>
        {ORG_ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {ORG_ENTITY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <FormActions onCancel={() => setAdding(false)} onSave={submit} disabled={!name.trim()} busy={busy} saveLabel="Add division" />
    </Panel>
  )
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function FormActions({
  onCancel,
  onSave,
  disabled,
  busy = false,
  saveLabel = 'Save',
}: {
  onCancel: () => void
  onSave: () => void
  disabled: boolean
  busy?: boolean
  saveLabel?: string
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-0.5">
      <button onClick={onCancel} className="h-8 px-3 rounded-md border border-input text-sm hover:bg-muted transition-colors">
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={disabled || busy}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {busy && <Loader2 size={13} className="animate-spin" />}
        {saveLabel}
      </button>
    </div>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  destructive = false,
}: {
  icon: typeof ArrowUp
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors disabled:opacity-40',
        destructive
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'text-foreground hover:bg-accent',
      )}
    >
      <Icon size={14} className="shrink-0" />
      {label}
    </button>
  )
}
