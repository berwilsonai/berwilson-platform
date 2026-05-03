'use client'

import { useState, useRef, useEffect } from 'react'
import { UserPlus, Check, Loader2, Link2, Link2Off, ChevronDown } from 'lucide-react'
import type { PartyMatchResult } from '@/types/domain'

interface Props {
  parties: PartyMatchResult[]
  allParties: { id: string; full_name: string; email: string | null }[]
}

type AddState = 'idle' | 'loading' | 'done' | 'error'
type LinkState = 'idle' | 'open' | 'loading' | 'done' | 'error'

// ---------------------------------------------------------------------------
// Single party chip
// ---------------------------------------------------------------------------

function PartyChip({
  party,
  allParties,
  index,
}: {
  party: PartyMatchResult
  allParties: Props['allParties']
  index: number
}) {
  const [addState, setAddState] = useState<AddState>('idle')
  const [linkState, setLinkState] = useState<LinkState>('idle')
  const [search, setSearch] = useState('')
  const [linkedName, setLinkedName] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // If the server already resolved a match, start in "done" state
  const isAlreadyMatched = !!party.matchedPartyId
  const displayMatchName = linkedName ?? party.matchedPartyName

  // Close dropdown on outside click
  useEffect(() => {
    if (linkState !== 'open') return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setLinkState('idle')
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [linkState])

  async function handleAddNew() {
    setAddState('loading')
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: party.name,
          company: party.company ?? undefined,
          title: party.role ?? undefined,
        }),
      })
      setAddState(res.ok ? 'done' : 'error')
    } catch {
      setAddState('error')
    }
  }

  async function handleAssociate(existingPartyId: string, existingName: string) {
    setLinkState('loading')
    try {
      const res = await fetch('/api/parties/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: party.name, party_id: existingPartyId }),
      })
      if (res.ok) {
        setLinkedName(existingName)
        setLinkState('done')
      } else {
        setLinkState('error')
      }
    } catch {
      setLinkState('error')
    }
    setSearch('')
  }

  const filtered = allParties.filter((p) =>
    p.full_name.toLowerCase().includes(search.toLowerCase())
  )

  // Matched / already-in-contacts state
  if (isAlreadyMatched || linkState === 'done') {
    return (
      <div className="flex items-center gap-1.5 bg-emerald-50 ring-1 ring-emerald-200 rounded px-2 py-1 text-xs">
        <Check size={11} className="text-emerald-600 shrink-0" />
        <span className="text-emerald-800 font-medium">{displayMatchName ?? party.name}</span>
        {displayMatchName && displayMatchName !== party.name && (
          <span className="text-emerald-600">({party.name})</span>
        )}
      </div>
    )
  }

  return (
    <div className="relative flex items-center gap-1.5 bg-muted rounded px-2 py-1 text-xs" ref={dropdownRef}>
      {/* Name + role */}
      <span className="text-foreground font-medium">{party.name}</span>
      {(party.company || party.role) && (
        <span className="text-muted-foreground">
          {[party.role, party.company].filter(Boolean).join(' · ')}
        </span>
      )}

      {/* Add as new contact */}
      {addState === 'done' ? (
        <Check size={11} className="text-emerald-600 shrink-0" />
      ) : (
        <button
          onClick={handleAddNew}
          disabled={addState === 'loading' || linkState === 'open'}
          title="Add as new contact"
          className="text-muted-foreground hover:text-primary disabled:opacity-50 transition-colors shrink-0"
        >
          {addState === 'loading' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <UserPlus size={11} />
          )}
        </button>
      )}

      {/* Link to existing contact */}
      {addState !== 'done' && (
        <button
          onClick={() => setLinkState(linkState === 'open' ? 'idle' : 'open')}
          disabled={addState === 'loading' || linkState === 'loading'}
          title="Link to existing contact"
          className="text-muted-foreground hover:text-primary disabled:opacity-50 transition-colors shrink-0 flex items-center gap-0.5"
        >
          {linkState === 'loading' ? (
            <Loader2 size={11} className="animate-spin" />
          ) : linkState === 'error' ? (
            <Link2Off size={11} className="text-red-500" />
          ) : (
            <>
              <Link2 size={11} />
              <ChevronDown size={9} />
            </>
          )}
        </button>
      )}

      {/* Contact picker dropdown */}
      {linkState === 'open' && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-popover shadow-lg">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              type="text"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border border-border bg-background outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="max-h-40 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No contacts found</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAssociate(p.id, p.full_name)}
                  className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                >
                  <span className="font-medium">{p.full_name}</span>
                  {p.email && (
                    <span className="text-muted-foreground ml-1.5">{p.email}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function MentionedPartiesPanel({ parties, allParties }: Props) {
  if (parties.length === 0) return null

  return (
    <div className="pt-2 border-t border-border">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
        People mentioned
      </p>
      <div className="flex flex-wrap gap-2">
        {parties.map((party, i) => (
          <PartyChip key={i} party={party} allParties={allParties} index={i} />
        ))}
      </div>
    </div>
  )
}
