'use client'

import { useState } from 'react'
import { Plus, Loader2, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  type TeamMember,
  type BoardTask,
  avatarClasses,
  initials,
  handleAuthError,
} from './task-utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: TeamMember[]
  tasks: BoardTask[]
  onAdded: (m: TeamMember) => void
  /** removedId + where their open tasks went (null = left unassigned). */
  onRemoved: (removedId: string, reassignTo: string | null) => void
}

/**
 * Add / remove the people who can be assigned tasks — right where tasks are
 * assigned. Removing is a soft deactivate: the person's contact and history
 * stay, they just stop appearing in the pickers. Their open tasks can be
 * reassigned in the same step so nothing is orphaned on a now-hidden owner.
 */
export default function ManageTeamDialog({ open, onOpenChange, members, tasks, onAdded, onRemoved }: Props) {
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<TeamMember | null>(null)
  const [reassignTo, setReassignTo] = useState('') // '' = leave unassigned
  const [busy, setBusy] = useState(false)

  const openCountFor = (id: string) =>
    tasks.filter((t) => t.status !== 'done' && t.assignee_id === id).length

  function reset() {
    setRemoving(null)
    setReassignTo('')
  }

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      const res = await fetch('/api/team-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (handleAuthError(res)) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add teammate')
      onAdded(data.member)
      setName('')
      toast.success(`${data.member.name} added`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add teammate')
    } finally {
      setAdding(false)
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setBusy(true)
    try {
      const res = await fetch(`/api/team-members/${removing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false, reassignTo: reassignTo || null }),
      })
      if (handleAuthError(res)) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to remove')
      onRemoved(removing.id, reassignTo || null)
      toast.success(`${removing.name} removed from the task board`)
      reset()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage team</DialogTitle>
          <DialogDescription>
            People who can be assigned tasks. Removing someone keeps their contact and task
            history — they just stop appearing here.
          </DialogDescription>
        </DialogHeader>

        {removing ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Remove <span className="font-semibold">{removing.name}</span> from the task board?
            </p>
            {openCountFor(removing.id) > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  They have {openCountFor(removing.id)} open task
                  {openCountFor(removing.id) === 1 ? '' : 's'}. Reassign to:
                </p>
                <select
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Leave unassigned</option>
                  {members
                    .filter((m) => m.id !== removing.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No open tasks assigned to them.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={reset}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={busy} onClick={confirmRemove}>
                {busy ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1">
              {members.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No team members yet.</p>
              ) : (
                members.map((m) => {
                  const oc = openCountFor(m.id)
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          'flex items-center justify-center size-7 rounded-full text-[11px] font-semibold',
                          avatarClasses(m.color),
                        )}
                      >
                        {initials(m.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {m.name}
                      </span>
                      {oc > 0 && <span className="tnum text-xs text-muted-foreground">{oc} open</span>}
                      <button
                        onClick={() => {
                          setReassignTo('')
                          setRemoving(m)
                        }}
                        className="shrink-0 inline-flex items-center justify-center size-7 rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${m.name}`}
                        title="Remove from task board"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className="border-t border-border pt-3">
              <label className="label-caps text-muted-foreground">Add teammate</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      add()
                    }
                  }}
                  placeholder="Full name…"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button disabled={!name.trim() || adding} onClick={add}>
                  {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Adds an assignable teammate (no login) and creates a matching contact.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
