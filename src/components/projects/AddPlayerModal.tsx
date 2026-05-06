'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Search, UserPlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'

type Party = {
  id: string
  full_name: string
  company: string | null
  title: string | null
}

type Phase = 'idle' | 'saving'

interface AddPlayerModalProps {
  projectId: string
}

export default function AddPlayerModal({ projectId }: AddPlayerModalProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const [parties, setParties] = useState<Party[]>([])
  const [loadingParties, setLoadingParties] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Party | null>(null)
  const [role, setRole] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setLoadingParties(true)
    setSearch('')
    setSelected(null)
    setRole('')
    setIsPrimary(false)
    setNotes('')
    setError(null)
    setPhase('idle')

    fetch('/api/parties')
      .then(r => r.json())
      .then(data => {
        setParties(Array.isArray(data) ? data : [])
        setLoadingParties(false)
      })
      .catch(() => setLoadingParties(false))
  }, [open])

  const filtered = useMemo(() => {
    if (!search.trim()) return parties
    const q = search.toLowerCase()
    return parties.filter(p =>
      p.full_name.toLowerCase().includes(q) ||
      p.company?.toLowerCase().includes(q) ||
      p.title?.toLowerCase().includes(q)
    )
  }, [parties, search])

  async function handleSave() {
    if (!selected || !role.trim()) return
    setPhase('saving')
    setError(null)

    try {
      const res = await fetch('/api/project-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          party_id: selected.id,
          role: role.trim(),
          is_primary: isPrimary,
          notes: notes.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to add player')
      }

      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add player')
      setPhase('idle')
    }
  }

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
  const canSave = selected && role.trim() && phase !== 'saving'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
      >
        <UserPlus size={14} />
        Add Player
      </button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Player to Project</DialogTitle>
          <DialogDescription>
            Search for an existing contact and assign their role on this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Contact search */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Contact
            </label>
            {selected ? (
              <div className="flex items-center justify-between rounded-md border border-input bg-muted/30 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{selected.full_name}</p>
                  {selected.company && (
                    <p className="text-xs text-muted-foreground">{selected.company}</p>
                  )}
                </div>
                <button
                  onClick={() => { setSelected(null); setSearch('') }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or company..."
                    className={`${inputClass} pl-7`}
                    disabled={loadingParties}
                    autoFocus
                  />
                </div>
                {loadingParties ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {filtered.slice(0, 20).map(party => (
                      <button
                        key={party.id}
                        onClick={() => setSelected(party)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                      >
                        <p className="text-sm font-medium">{party.full_name}</p>
                        {(party.company || party.title) && (
                          <p className="text-xs text-muted-foreground">
                            {[party.title, party.company].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                ) : search ? (
                  <p className="text-xs text-muted-foreground px-1">No contacts found.</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Role <span className="text-red-500">*</span>
            </label>
            <input
              value={role}
              onChange={e => setRole(e.target.value)}
              placeholder="e.g. Owner, GC, Architect, Lender..."
              disabled={phase === 'saving'}
              className={inputClass}
            />
          </div>

          {/* Primary */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-primary"
              checked={isPrimary}
              onChange={e => setIsPrimary(e.target.checked)}
              disabled={phase === 'saving'}
              className="size-4 rounded border-input"
            />
            <label htmlFor="is-primary" className="text-sm text-muted-foreground cursor-pointer">
              Mark as primary contact
            </label>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this player's involvement..."
              rows={2}
              disabled={phase === 'saving'}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => setOpen(false)}
            disabled={phase === 'saving'}
            className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {phase === 'saving' ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Check size={14} />
                Add Player
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
