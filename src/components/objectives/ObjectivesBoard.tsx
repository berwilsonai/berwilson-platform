'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Plus,
  X,
  Loader2,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  FileDown,
  Target,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import EmptyState from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import {
  OBJECTIVE_BUCKETS,
  OBJECTIVE_BUCKET_LABELS,
  OBJECTIVE_BUCKET_ACCENT,
  type ObjectiveBucket,
} from '@/lib/utils/objectives'
import {
  type TeamMember,
  avatarClasses,
  initials,
  formatDate,
  handleAuthError,
} from '@/components/tasks/task-utils'

export interface BoardObjective {
  id: string
  title: string
  note: string | null
  bucket: string
  sort_order: number
  owner_id: string | null
  target_date: string | null
  status: string
  owner: { id: string; name: string; color: string | null } | null
  created_at: string | null
}

interface ObjectivesBoardProps {
  initialObjectives: BoardObjective[]
  teamMembers: TeamMember[]
}

interface DropTarget {
  bucket: ObjectiveBucket
  index: number
}

const fieldClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export default function ObjectivesBoard({ initialObjectives, teamMembers }: ObjectivesBoardProps) {
  const [objectives, setObjectives] = useState<BoardObjective[]>(initialObjectives)

  // drag state
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  // Snapshot for reverting an optimistic reorder that fails to persist.
  const preDragRef = useRef<BoardObjective[]>(initialObjectives)

  // per-card UI state
  const [menuId, setMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // quick-add (one open at a time, keyed by bucket)
  const [addBucket, setAddBucket] = useState<ObjectiveBucket | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const [showArchive, setShowArchive] = useState(false)

  const byBucket = useMemo(() => {
    const map = {} as Record<ObjectiveBucket, BoardObjective[]>
    for (const b of OBJECTIVE_BUCKETS) {
      map[b] = objectives
        .filter((o) => o.status === 'active' && o.bucket === b)
        .sort((a, b2) => a.sort_order - b2.sort_order)
    }
    return map
  }, [objectives])

  const archived = useMemo(
    () =>
      objectives
        .filter((o) => o.status === 'archived')
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
    [objectives],
  )

  const activeCount = OBJECTIVE_BUCKETS.reduce((n, b) => n + byBucket[b].length, 0)

  // ── Persistence helpers ────────────────────────────────────────────────────

  /**
   * Apply a structural move: rebuild the two affected bucket lists with fresh
   * sequential sort_orders, update state optimistically, and persist. Reverts
   * to the pre-move snapshot on failure.
   */
  async function commitMove(next: BoardObjective[], snapshot: BoardObjective[], affected: Set<ObjectiveBucket>) {
    setObjectives(next)
    const items = next
      .filter((o) => o.status === 'active' && affected.has(o.bucket as ObjectiveBucket))
      .map((o) => ({ id: o.id, bucket: o.bucket as ObjectiveBucket, sort_order: o.sort_order }))
    try {
      const res = await fetch('/api/objectives/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
    } catch {
      setObjectives(snapshot)
      toast.error('Failed to save the new order')
    }
  }

  /** Move an objective to (bucket, index) within the active lists. */
  function moveObjective(id: string, bucket: ObjectiveBucket, index: number, snapshot: BoardObjective[]) {
    const moved = objectives.find((o) => o.id === id)
    if (!moved) return
    const from = moved.bucket as ObjectiveBucket

    const lists: Record<ObjectiveBucket, BoardObjective[]> = {
      now: [...byBucket.now],
      soon: [...byBucket.soon],
      possibly: [...byBucket.possibly],
    }

    const fromIdx = lists[from].findIndex((o) => o.id === id)
    if (fromIdx === -1) return
    lists[from].splice(fromIdx, 1)

    let insertAt = index
    if (from === bucket && fromIdx < index) insertAt -= 1
    insertAt = Math.max(0, Math.min(insertAt, lists[bucket].length))
    lists[bucket].splice(insertAt, 0, { ...moved, bucket })

    const affected = new Set<ObjectiveBucket>([from, bucket])
    const repositioned = new Map<string, { bucket: ObjectiveBucket; sort_order: number }>()
    for (const b of affected) {
      lists[b].forEach((o, i) => repositioned.set(o.id, { bucket: b, sort_order: i }))
    }

    const next = objectives.map((o) => {
      const pos = repositioned.get(o.id)
      return pos ? { ...o, bucket: pos.bucket, sort_order: pos.sort_order } : o
    })
    commitMove(next, snapshot, affected)
  }

  async function patchObjective(id: string, patch: Record<string, unknown>): Promise<BoardObjective | null> {
    const res = await fetch(`/api/objectives/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (handleAuthError(res)) return null
    if (!res.ok) throw new Error()
    const data = await res.json()
    return data.objective as BoardObjective
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleAdd(bucket: ObjectiveBucket) {
    if (!addTitle.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/objectives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: addTitle.trim(), bucket }),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      const data = await res.json()
      setObjectives((prev) => [...prev, data.objective])
      setAddTitle('')
      toast.success('Objective added')
    } catch {
      toast.error('Failed to add objective')
    } finally {
      setAdding(false)
    }
  }

  async function handleSetStatus(obj: BoardObjective, status: 'active' | 'archived') {
    setMenuId(null)
    const prev = objectives
    setObjectives((p) => p.map((o) => (o.id === obj.id ? { ...o, status } : o)))
    try {
      await patchObjective(obj.id, { status })
      toast.success(status === 'archived' ? 'Objective archived' : 'Objective restored')
    } catch {
      setObjectives(prev)
      toast.error('Failed to update')
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    const prev = objectives
    setObjectives((p) => p.filter((o) => o.id !== deleteId))
    try {
      const res = await fetch(`/api/objectives/${deleteId}`, { method: 'DELETE' })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      toast.success('Objective deleted')
    } catch {
      setObjectives(prev)
      toast.error('Failed to delete')
    } finally {
      setDeleteId(null)
    }
  }

  async function handleSaveEdit(obj: BoardObjective, patch: { title: string; note: string; owner_id: string; target_date: string }) {
    const prev = objectives
    setObjectives((p) =>
      p.map((o) =>
        o.id === obj.id
          ? {
              ...o,
              title: patch.title.trim() || o.title,
              note: patch.note.trim() || null,
              owner_id: patch.owner_id || null,
              owner: teamMembers.find((m) => m.id === patch.owner_id) ?? null,
              target_date: patch.target_date || null,
            }
          : o,
      ),
    )
    setEditingId(null)
    try {
      await patchObjective(obj.id, patch)
      toast.success('Objective updated')
    } catch {
      setObjectives(prev)
      toast.error('Failed to save changes')
    }
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  function handleDrop() {
    if (dragId && dropTarget) {
      moveObjective(dragId, dropTarget.bucket, dropTarget.index, preDragRef.current)
    }
    setDragId(null)
    setDropTarget(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const deleteTarget = objectives.find((o) => o.id === deleteId)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Objectives</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} active — drag to prioritize
          </p>
        </div>
        <Link
          href="/objectives/print"
          target="_blank"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-accent transition-colors elev-1"
        >
          <FileDown size={15} /> Export PDF
        </Link>
      </div>

      {/* Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {OBJECTIVE_BUCKETS.map((bucket) => {
          const list = byBucket[bucket]
          const isAddOpen = addBucket === bucket
          return (
            <div
              key={bucket}
              className={cn(
                'rounded-xl border bg-card/50 p-3 transition-colors',
                dragId && dropTarget?.bucket === bucket ? 'border-primary/50 bg-primary/5' : 'border-border',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                // Only when hovering column chrome (cards set their own target and stop propagation).
                setDropTarget({ bucket, index: list.length })
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop()
              }}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-1 pb-2">
                <span className={cn('size-2 rounded-full', OBJECTIVE_BUCKET_ACCENT[bucket])} />
                <h2 className="text-sm font-semibold text-foreground">{OBJECTIVE_BUCKET_LABELS[bucket]}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{list.length}</span>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                {list.length === 0 && !dragId && !isAddOpen && (
                  <p className="px-1 py-3 text-xs text-muted-foreground">Nothing here yet.</p>
                )}
                {list.map((obj, idx) => (
                  <div key={obj.id}>
                    {dragId && dropTarget?.bucket === bucket && dropTarget.index === idx && dragId !== obj.id && (
                      <div className="h-0.5 rounded-full bg-primary mb-2" />
                    )}
                    <ObjectiveCard
                      obj={obj}
                      rank={idx + 1}
                      bucket={bucket}
                      listLength={list.length}
                      teamMembers={teamMembers}
                      dragging={dragId === obj.id}
                      menuOpen={menuId === obj.id}
                      editing={editingId === obj.id}
                      onDragStart={() => {
                        preDragRef.current = objectives
                        setDragId(obj.id)
                        setMenuId(null)
                        setEditingId(null)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setDropTarget(null)
                      }}
                      onDragOverCard={(before) => {
                        setDropTarget({ bucket, index: before ? idx : idx + 1 })
                      }}
                      onDrop={handleDrop}
                      onToggleMenu={() => setMenuId((m) => (m === obj.id ? null : obj.id))}
                      onCloseMenu={() => setMenuId(null)}
                      onMoveStep={(dir) => {
                        setMenuId(null)
                        moveObjective(obj.id, bucket, dir === 'up' ? idx - 1 : idx + 2, objectives)
                      }}
                      onMoveToBucket={(b) => {
                        setMenuId(null)
                        moveObjective(obj.id, b, byBucket[b].length, objectives)
                      }}
                      onEdit={() => {
                        setMenuId(null)
                        setEditingId(obj.id)
                      }}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(patch) => handleSaveEdit(obj, patch)}
                      onArchive={() => handleSetStatus(obj, 'archived')}
                      onDelete={() => {
                        setMenuId(null)
                        setDeleteId(obj.id)
                      }}
                    />
                  </div>
                ))}
                {dragId && dropTarget?.bucket === bucket && dropTarget.index >= list.length && (
                  <div className="h-0.5 rounded-full bg-primary" />
                )}
              </div>

              {/* Quick add */}
              {isAddOpen ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleAdd(bucket) }
                      if (e.key === 'Escape') { setAddBucket(null); setAddTitle('') }
                    }}
                    placeholder="New objective…"
                    autoFocus
                    className={cn(fieldClass, 'flex-1 min-w-0')}
                  />
                  <button
                    onClick={() => handleAdd(bucket)}
                    disabled={!addTitle.trim() || adding}
                    className="shrink-0 inline-flex items-center justify-center size-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    aria-label="Save objective"
                  >
                    {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  </button>
                  <button
                    onClick={() => { setAddBucket(null); setAddTitle('') }}
                    className="shrink-0 inline-flex items-center justify-center size-9 rounded-md border border-input hover:bg-muted"
                    aria-label="Cancel"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setAddBucket(bucket); setAddTitle('') }}
                  className="mt-2 w-full inline-flex items-center gap-1.5 px-2 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Plus size={14} /> Add objective
                </button>
              )}
            </div>
          )
        })}
      </div>

      {activeCount === 0 && (
        <EmptyState
          icon={Target}
          title="No objectives yet"
          description="Add the priorities steering the company — Now, Soon, or Possibly."
        />
      )}

      {/* Archive */}
      <div>
        <button
          onClick={() => setShowArchive((s) => !s)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showArchive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Archive <span className="tabular-nums">({archived.length})</span>
        </button>
        {showArchive && (
          <div className="mt-2 space-y-2">
            {archived.length === 0 ? (
              <p className="text-xs text-muted-foreground">Archived objectives land here for the record.</p>
            ) : (
              archived.map((obj) => (
                <div key={obj.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 opacity-70">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-muted-foreground truncate">{obj.title}</p>
                    {obj.note && <p className="text-xs text-muted-foreground/80 truncate">{obj.note}</p>}
                  </div>
                  <button
                    onClick={() => handleSetStatus(obj, 'active')}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArchiveRestore size={13} /> Restore
                  </button>
                  <button
                    onClick={() => setDeleteId(obj.id)}
                    className="shrink-0 inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:bg-muted transition-colors"
                    aria-label="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Delete objective?"
        description={deleteTarget ? `"${deleteTarget.title}" will be permanently removed. Archiving keeps the record instead.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface ObjectiveCardProps {
  obj: BoardObjective
  rank: number
  bucket: ObjectiveBucket
  listLength: number
  teamMembers: TeamMember[]
  dragging: boolean
  menuOpen: boolean
  editing: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverCard: (before: boolean) => void
  onDrop: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onMoveStep: (dir: 'up' | 'down') => void
  onMoveToBucket: (b: ObjectiveBucket) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (patch: { title: string; note: string; owner_id: string; target_date: string }) => void
  onArchive: () => void
  onDelete: () => void
}

function ObjectiveCard({
  obj, rank, bucket, listLength, teamMembers, dragging, menuOpen, editing,
  onDragStart, onDragEnd, onDragOverCard, onDrop,
  onToggleMenu, onCloseMenu, onMoveStep, onMoveToBucket,
  onEdit, onCancelEdit, onSaveEdit, onArchive, onDelete,
}: ObjectiveCardProps) {
  const otherBuckets = OBJECTIVE_BUCKETS.filter((b) => b !== bucket)

  if (editing) {
    return (
      <ObjectiveEditForm
        obj={obj}
        teamMembers={teamMembers}
        onCancel={onCancelEdit}
        onSave={onSaveEdit}
      />
    )
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        onDragOverCard(e.clientY < rect.top + rect.height / 2)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop()
      }}
      onClick={onEdit}
      className={cn(
        'group relative flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-3 cursor-grab active:cursor-grabbing lift',
        dragging && 'opacity-40',
      )}
    >
      <span
        className={cn(
          'shrink-0 mt-0.5 inline-flex items-center justify-center size-5 rounded-full text-[11px] font-semibold tabular-nums',
          bucket === 'now'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{obj.title}</p>
        {obj.note && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{obj.note}</p>}
        {(obj.owner || obj.target_date) && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {obj.owner && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('inline-flex items-center justify-center size-5 rounded-full text-[9px] font-semibold', avatarClasses(obj.owner.color))}>
                  {initials(obj.owner.name)}
                </span>
                {obj.owner.name}
              </span>
            )}
            {obj.target_date && (
              <span className="text-xs text-muted-foreground tnum">Target {formatDate(obj.target_date)}</span>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-0.5">
        <GripVertical size={14} className="hidden md:block text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
        <button
          onClick={(e) => { e.stopPropagation(); onToggleMenu() }}
          className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Objective actions"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>

      {menuOpen && (
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); onCloseMenu() }} />
          <div
            className="absolute right-2 top-10 z-30 w-44 rounded-lg border border-border bg-card py-1 elev-3"
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem icon={ArrowUp} label="Move up" disabled={rank === 1} onClick={() => onMoveStep('up')} />
            <MenuItem icon={ArrowDown} label="Move down" disabled={rank === listLength} onClick={() => onMoveStep('down')} />
            <div className="my-1 border-t border-border" />
            {otherBuckets.map((b) => (
              <MenuItem key={b} icon={Target} label={`Move to ${OBJECTIVE_BUCKET_LABELS[b]}`} onClick={() => onMoveToBucket(b)} />
            ))}
            <div className="my-1 border-t border-border" />
            <MenuItem icon={Pencil} label="Edit" onClick={onEdit} />
            <MenuItem icon={Archive} label="Archive" onClick={onArchive} />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={onDelete} />
          </div>
        </>
      )}
    </div>
  )
}

/** Mounted only while editing, so its fields always initialize from the current row. */
function ObjectiveEditForm({
  obj,
  teamMembers,
  onCancel,
  onSave,
}: {
  obj: BoardObjective
  teamMembers: TeamMember[]
  onCancel: () => void
  onSave: (patch: { title: string; note: string; owner_id: string; target_date: string }) => void
}) {
  const [title, setTitle] = useState(obj.title)
  const [note, setNote] = useState(obj.note ?? '')
  const [ownerId, setOwnerId] = useState(obj.owner_id ?? '')
  const [targetDate, setTargetDate] = useState(obj.target_date ?? '')

  return (
    <div className="rounded-xl border border-primary/40 bg-card p-3 space-y-2.5 elev-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Objective"
        autoFocus
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note — context, numbers, options…"
        rows={2}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={fieldClass}>
          <option value="">No owner</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <DatePicker value={targetDate} onChange={setTargetDate} placeholder="Target date" />
      </div>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          onClick={onCancel}
          className="h-8 px-3 rounded-md border border-input text-sm hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave({ title, note, owner_id: ownerId, target_date: targetDate })}
          disabled={!title.trim()}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          Save
        </button>
      </div>
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
