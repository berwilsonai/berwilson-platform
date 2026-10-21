'use client'

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { groupRoles, roleChipClasses, type ContactRoleView } from '@/lib/utils/contact-roles'

interface ContactRolesEditorProps {
  partyId: string
  initialRoles: string[]
  /** The whole registry. Retired roles render but cannot be added. */
  roles: ContactRoleView[]
}

/**
 * What somebody is TO US — the field the directory had no column for.
 *
 * Saves on every change, optimistically, and reverts on failure: the same
 * contract as ContactTagsEditor beside it, so the two behave alike on one card.
 *
 * ⚠ The PICKER shows the whole active registry, unlike the /contacts filter
 * which shows only roles in use. Different questions: filtering asks "who do we
 * have", choosing asks "what is this person" (§12 — derive the filter from the
 * values present, keep the curated list for what a human picks from).
 */
export default function ContactRolesEditor({
  partyId,
  initialRoles,
  roles,
}: ContactRolesEditorProps) {
  const [selected, setSelected] = useState<string[]>(initialRoles)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const byKey = useMemo(() => new Map(roles.map(r => [r.key, r])), [roles])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const available = roles.filter(r => {
      if (!r.active && !selected.includes(r.key)) return false
      if (!q) return true
      return r.label.toLowerCase().includes(q) || r.role_group.toLowerCase().includes(q)
    })
    return groupRoles(available)
  }, [roles, query, selected])

  async function save(next: string[]) {
    const previous = selected
    setSelected(next)
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${partyId}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSelected(previous)
        toast.error(data?.error ?? 'Failed to save roles')
      }
    } catch {
      setSelected(previous)
      toast.error('Failed to save roles')
    } finally {
      setSaving(false)
    }
  }

  function toggle(key: string) {
    save(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {selected.length === 0 && (
          <span className="text-xs text-muted-foreground">No role yet</span>
        )}
        {selected
          .map(k => byKey.get(k))
          .filter((r): r is ContactRoleView => !!r)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(r => (
            <span
              key={r.key}
              className={cn(
                'inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs ring-1',
                roleChipClasses(r.role_group)
              )}
            >
              {r.label}
              {!r.active && <span className="opacity-60">(retired)</span>}
              <button
                type="button"
                onClick={() => toggle(r.key)}
                aria-label={`Remove ${r.label}`}
                className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="h-[2.75rem] sm:h-7 px-2 rounded-md border border-input text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {open ? 'Done' : '+ Role'}
        </button>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      {open && (
        <div className="rounded-lg border border-border bg-background p-3 space-y-3 max-h-80 overflow-y-auto">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search roles…"
              className="w-full h-8 pl-7 pr-2 rounded-md border border-input bg-background text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No role matches. Add one at <span className="font-medium">Settings → Contact roles</span>.
            </p>
          )}
          {groups.map(({ group, roles: groupRolesList }) => (
            <div key={group} className="space-y-1">
              <p className="label-caps text-muted-foreground">{group}</p>
              <div className="flex flex-wrap gap-1.5">
                {groupRolesList.map(r => {
                  const on = selected.includes(r.key)
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => toggle(r.key)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        on
                          ? roleChipClasses(r.role_group)
                          : 'bg-background text-muted-foreground ring-border hover:bg-muted'
                      )}
                    >
                      {on && <Check size={11} />}
                      {r.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
