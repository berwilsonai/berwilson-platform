'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2, Search, Users, Building2, CheckCircle2, X } from 'lucide-react'
import type { MeetingAttendee } from '@/lib/utils/meetings'

export interface TeamMemberOption {
  id: string
  name: string
  party_id: string | null
}
export interface ContactOption {
  id: string
  full_name: string
  company: string | null
  email: string | null
  is_organization: boolean | null
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

interface Props {
  attendees: MeetingAttendee[]
  onChange: (next: MeetingAttendee[]) => void
  teamMembers: TeamMemberOption[]
  contacts: ContactOption[]
}

/** Type-ahead over the whole contacts directory — links an attendee to a real
 *  contact (parties.id) so nothing duplicates and the meeting logs on their profile. */
function ContactSearch({ contacts, onPick }: { contacts: ContactOption[]; onPick: (c: ContactOption) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return contacts
      .filter((c) => c.full_name.toLowerCase().includes(s) || (c.company ?? '').toLowerCase().includes(s))
      .slice(0, 8)
  }, [q, contacts])

  return (
    <div className="relative flex-1 min-w-[12rem]">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        className={`${inputClass} h-8 pl-8`}
        placeholder="Search contacts directory…"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-card shadow-lg">
          {options.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(c); setQ(''); setOpen(false) }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent transition-colors"
            >
              {c.is_organization && <Building2 size={12} className="text-muted-foreground shrink-0" />}
              <span className="truncate flex-1">{c.full_name}</span>
              {c.company && <span className="text-[11px] text-muted-foreground truncate max-w-[8rem]">{c.company}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Attendee editor used across board / project / opportunity meetings.
 * Three ways to add a person, in priority order per the spec:
 *   1) pick a Ber Wilson team member  2) search the contacts directory
 *   3) enter a name / title / company manually.
 * Team + contact picks carry a link id so the meeting logs on the contact's
 * profile; manual rows carry no link.
 */
export default function MeetingAttendees({ attendees, onChange, teamMembers, contacts }: Props) {
  function update(i: number, patch: Partial<MeetingAttendee>) {
    onChange(attendees.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }
  function remove(i: number) {
    onChange(attendees.filter((_, idx) => idx !== i))
  }
  function addTeamMember(m: TeamMemberOption) {
    onChange([
      ...attendees,
      { name: m.name, role: null, org: 'Ber Wilson', party_id: m.party_id, team_member_id: m.id },
    ])
  }
  function addContact(c: ContactOption) {
    onChange([
      ...attendees,
      { name: c.full_name, role: null, org: c.company, party_id: c.id, team_member_id: null },
    ])
  }
  function addManual() {
    onChange([...attendees, { name: '', role: null, org: null, party_id: null, team_member_id: null }])
  }

  // Team members already added (by link) so we don't offer them twice.
  const addedMemberIds = useMemo(
    () => new Set(attendees.map((a) => a.team_member_id).filter(Boolean) as string[]),
    [attendees],
  )
  const availableMembers = teamMembers.filter((m) => !addedMemberIds.has(m.id))

  return (
    <div className="space-y-2">
      {/* Add controls */}
      <div className="flex flex-wrap items-center gap-2">
        {availableMembers.length > 0 && (
          <select
            className={`${inputClass} h-8 w-auto max-w-[14rem]`}
            value=""
            onChange={(e) => {
              const m = teamMembers.find((x) => x.id === e.target.value)
              if (m) addTeamMember(m)
              e.target.value = ''
            }}
            title="Add a Ber Wilson team member"
          >
            <option value="">＋ Ber Wilson team…</option>
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
        <ContactSearch contacts={contacts} onPick={addContact} />
        <button
          type="button"
          onClick={addManual}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent shrink-0"
        >
          <Plus size={13} /> Enter manually
        </button>
      </div>

      {/* Rows */}
      {attendees.length === 0 ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Users size={13} /> Add attendees from the team, the contacts directory, or by hand.
        </p>
      ) : (
        <div className="space-y-2">
          {attendees.map((a, i) => {
            const linked = a.team_member_id ? 'team' : a.party_id ? 'contact' : null
            return (
              <div key={i} className="rounded-md border border-border/60 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input className={`${inputClass} h-8 flex-1`} value={a.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" />
                  <input className={`${inputClass} h-8 flex-1`} value={a.role ?? ''} onChange={(e) => update(i, { role: e.target.value || null })} placeholder="Title / role" />
                  <input className={`${inputClass} h-8 flex-1`} value={a.org ?? ''} onChange={(e) => update(i, { org: e.target.value || null })} placeholder="Company" />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
                    aria-label="Remove attendee"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {linked && (
                  <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 text-[11px] text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={11} />
                    {linked === 'team' ? 'Ber Wilson team member' : 'Linked contact'}
                    <button
                      type="button"
                      onClick={() => update(i, { party_id: null, team_member_id: null })}
                      className="ml-0.5 hover:text-destructive"
                      title="Unlink (keeps the name, stops logging on the contact)"
                    >
                      <X size={11} />
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
