'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Pencil } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { FIELD_CONTROL_CLASS } from '@/lib/utils/field-classes'
import { groupRoles, type ContactRoleView } from '@/lib/utils/contact-roles'

interface EditRoleButtonProps {
  playerId: string
  currentRole: string
  /** The registry key already on the row, when it has one. */
  currentRoleKey: string | null
  playerName: string
  /** The role registry, passed from the server page. */
  roles: ContactRoleView[]
}

/**
 * ⚠ Reads the REGISTRY, not the old `PROJECT_PLAYER_ROLES` array.
 *
 * That array held 33 hand-written values that this component and AddPlayerModal
 * read and nothing else did — 1 of 104 live rows conformed to it (measured
 * 2026-10-21), because every automated writer bypassed both components. The
 * list is now `contact_roles` and a role added in settings appears here with
 * no deploy.
 *
 * The select writes BOTH columns: `role` gets the label (what a reader sees),
 * `role_key` the key (what the filter reads). "Custom…" writes prose and a NULL
 * key, which is how a row stays honestly uncategorised rather than being forced
 * into the nearest category.
 */
export default function EditRoleButton({
  playerId,
  currentRole,
  currentRoleKey,
  playerName,
  roles,
}: EditRoleButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const activeRoles = roles.filter(r => r.active || r.key === currentRoleKey)
  const initial = currentRoleKey && activeRoles.some(r => r.key === currentRoleKey)
    ? currentRoleKey
    : '__custom__'
  const [role, setRole] = useState(initial)
  const [customRole, setCustomRole] = useState(initial === '__custom__' ? currentRole : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpen() {
    setRole(initial)
    setCustomRole(initial === '__custom__' ? currentRole : '')
    setError(null)
    setOpen(true)
  }

  async function handleSave() {
    const custom = role === '__custom__'
    const picked = custom ? null : activeRoles.find(r => r.key === role)
    const finalRole = custom ? customRole.trim() : (picked?.label ?? '')
    if (!finalRole) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/records/project-players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: finalRole, role_key: picked?.key ?? null }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to update role')
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
      setSaving(false)
    }
  }

  const inputClass = FIELD_CONTROL_CLASS
  const effectiveRole = role === '__custom__' ? customRole.trim() : role.trim()
  const canSave = effectiveRole && !saving

  return (
    <>
      <button
        onClick={handleOpen}
        className="ml-1.5 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center justify-center size-5 rounded hover:bg-muted transition-colors"
        aria-label={`Edit role for ${playerName}`}
      >
        <Pencil size={11} className="text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Updating role for <span className="font-medium text-foreground">{playerName}</span>
            </p>
            {error && <p className="text-sm text-critical">{error}</p>}
            <div className="space-y-1.5">
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                disabled={saving}
                className={inputClass}
              >
                <option value="">Select a role...</option>
                {groupRoles(activeRoles).map(({ group, roles: groupRoles_ }) => (
                  <optgroup key={group} label={group}>
                    {groupRoles_.map(r => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </optgroup>
                ))}
                <option value="__custom__">Custom...</option>
              </select>
              {role === '__custom__' && (
                <input
                  value={customRole}
                  onChange={e => setCustomRole(e.target.value)}
                  placeholder="Enter custom role..."
                  disabled={saving}
                  className={inputClass}
                  autoFocus
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              disabled={saving}
              className="inline-flex items-center h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Save
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
