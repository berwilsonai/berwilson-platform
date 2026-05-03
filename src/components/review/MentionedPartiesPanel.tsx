'use client'

import { useState } from 'react'
import { UserPlus, Check, Loader2 } from 'lucide-react'
import type { MentionedParty } from '@/types/domain'

interface Props {
  parties: MentionedParty[]
}

type AddState = 'idle' | 'loading' | 'done' | 'error'

export default function MentionedPartiesPanel({ parties }: Props) {
  const [states, setStates] = useState<Record<number, AddState>>({})

  if (parties.length === 0) return null

  async function addContact(party: MentionedParty, index: number) {
    setStates((s) => ({ ...s, [index]: 'loading' }))
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
      setStates((s) => ({ ...s, [index]: res.ok ? 'done' : 'error' }))
    } catch {
      setStates((s) => ({ ...s, [index]: 'error' }))
    }
  }

  return (
    <div className="pt-2 border-t border-border">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
        People mentioned
      </p>
      <div className="flex flex-wrap gap-2">
        {parties.map((party, i) => {
          const state = states[i] ?? 'idle'
          return (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-muted rounded px-2 py-1 text-xs"
            >
              <span className="text-foreground font-medium">{party.name}</span>
              {(party.company || party.role) && (
                <span className="text-muted-foreground">
                  {[party.role, party.company].filter(Boolean).join(' · ')}
                </span>
              )}
              {state === 'done' ? (
                <Check size={11} className="text-emerald-600 shrink-0" />
              ) : (
                <button
                  onClick={() => addContact(party, i)}
                  disabled={state === 'loading'}
                  title="Add as contact"
                  className="text-muted-foreground hover:text-primary disabled:opacity-50 transition-colors shrink-0"
                >
                  {state === 'loading' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <UserPlus size={11} />
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
