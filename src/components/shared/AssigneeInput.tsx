'use client'

import { useState, useEffect, useMemo, useRef } from 'react'

type Party = {
  id: string
  full_name: string
  company: string | null
  title: string | null
  is_organization: boolean | null
}

interface AssigneeInputProps {
  value: string
  onChange: (value: string) => void
  /**
   * Fires with the selected contact's id when a suggestion is picked, or null
   * when the field is free-typed (i.e. not a confirmed contact). Lets the
   * caller store a real link to the contact rather than just a name string.
   */
  onPartyChange?: (partyId: string | null) => void
  placeholder?: string
  className?: string
}

/**
 * Inline contact picker for task assignees. Suggests existing contacts
 * (parties) as you type, but also accepts free text for people who aren't
 * contacts yet. The stored value is the contact's name string (matching the
 * existing action_items.assignee shape); when a suggestion is picked, the
 * contact's id is also reported via onPartyChange so the task can be tagged
 * to a real contact record.
 */
export default function AssigneeInput({
  value,
  onChange,
  onPartyChange,
  placeholder = 'Assignee (optional)',
  className = '',
}: AssigneeInputProps) {
  const [parties, setParties] = useState<Party[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Load contacts once on mount
  useEffect(() => {
    let active = true
    fetch('/api/parties')
      .then(r => r.json())
      .then(data => { if (active) setParties(Array.isArray(data) ? data : []) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase()
    // Tasks are done by people — suggest individuals, not organizations.
    const individuals = parties.filter(p => !p.is_organization)
    const list = q
      ? individuals.filter(p =>
          p.full_name.toLowerCase().includes(q) ||
          p.company?.toLowerCase().includes(q) ||
          p.title?.toLowerCase().includes(q)
        )
      : individuals
    return list.slice(0, 8)
  }, [parties, value])

  const baseClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); onPartyChange?.(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={`${baseClass} ${className}`}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md divide-y divide-border">
          {suggestions.map(party => (
            <button
              key={party.id}
              type="button"
              onClick={() => { onChange(party.full_name); onPartyChange?.(party.id); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
            >
              <p className="text-sm font-medium text-foreground">{party.full_name}</p>
              {(party.company || party.title) && (
                <p className="text-xs text-muted-foreground">
                  {[party.title, party.company].filter(Boolean).join(' · ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
