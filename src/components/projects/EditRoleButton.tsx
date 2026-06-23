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
import { PROJECT_PLAYER_ROLES, PROJECT_PLAYER_ROLE_GROUPS } from '@/lib/utils/constants'

interface EditRoleButtonProps {
  playerId: string
  currentRole: string
  playerName: string
}

export default function EditRoleButton({ playerId, currentRole, playerName }: EditRoleButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const isKnownRole = PROJECT_PLAYER_ROLES.some(r => r.value === currentRole)
  const [role, setRole] = useState(isKnownRole ? currentRole : '__custom__')
  const [customRole, setCustomRole] = useState(isKnownRole ? '' : currentRole)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpen() {
    const known = PROJECT_PLAYER_ROLES.some(r => r.value === currentRole)
    setRole(known ? currentRole : '__custom__')
    setCustomRole(known ? '' : currentRole)
    setError(null)
    setOpen(true)
  }

  async function handleSave() {
    const finalRole = role === '__custom__' ? customRole.trim() : role.trim()
    if (!finalRole) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/project-players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: finalRole }),
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

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
  const effectiveRole = role === '__custom__' ? customRole.trim() : role.trim()
  const canSave = effectiveRole && !saving

  return (
    <>
      <button
        onClick={handleOpen}
        className="ml-1.5 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center size-5 rounded hover:bg-muted transition-colors"
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
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="space-y-1.5">
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                disabled={saving}
                className={inputClass}
              >
                <option value="">Select a role...</option>
                {PROJECT_PLAYER_ROLE_GROUPS.map(group => (
                  <optgroup key={group} label={group}>
                    {PROJECT_PLAYER_ROLES.filter(r => r.group === group).map(r => (
                      <option key={r.value} value={r.value}>{r.value}</option>
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
