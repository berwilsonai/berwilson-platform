'use client'

import { useMemo, useState } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle, Link2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { createInvestor, updateInvestor } from '@/app/investors/actions'
import type { InvestorFormState } from '@/app/investors/actions'
import type { Investor } from '@/lib/supabase/types'
import { SECTORS, SECTOR_LABELS } from '@/lib/utils/constants'
import {
  INVESTOR_TYPES,
  INVESTOR_TYPE_LABELS,
  INVESTOR_STAGES,
  INVESTOR_STAGE_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  INSTRUMENTS,
  INSTRUMENT_LABELS,
} from '@/lib/utils/investors'

const inputClass = cn(
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
)
const textareaClass = cn(
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
  'min-h-[80px] resize-y'
)
const labelClass = 'block text-xs font-medium text-foreground mb-1'

export interface PartyOption {
  id: string
  full_name: string
  company: string | null
}

interface InvestorFormProps {
  mode: 'create' | 'edit'
  investor?: Investor
  parties: PartyOption[]
  teamMembers: { id: string; name: string }[]
  /** Name of the currently linked directory contact (edit mode). */
  linkedPartyName?: string | null
}

export default function InvestorForm({ mode, investor, parties, teamMembers, linkedPartyName }: InvestorFormProps) {
  const action =
    mode === 'edit' && investor
      ? updateInvestor.bind(null, investor.id)
      : createInvestor

  const [state, formAction, isPending] = useActionState<InvestorFormState, FormData>(action, null)

  // Directory link: typing searches contacts; picking one links it (party_id).
  const [name, setName] = useState(investor?.name ?? '')
  const [partyId, setPartyId] = useState<string>('')
  const [linkedName, setLinkedName] = useState<string | null>(mode === 'edit' ? (linkedPartyName ?? null) : null)
  const [suggestOpen, setSuggestOpen] = useState(false)

  const suggestions = useMemo(() => {
    const q = name.trim().toLowerCase()
    if (q.length < 2) return []
    return parties
      .filter((p) => p.full_name.toLowerCase().includes(q) || (p.company ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [name, parties])

  function pickParty(p: PartyOption) {
    setName(p.full_name)
    setPartyId(p.id)
    setLinkedName(p.full_name)
    setSuggestOpen(false)
  }

  const cancelHref = mode === 'edit' && investor ? `/investors/${investor.id}` : '/investors'

  const structures = (investor?.preferred_structures ?? []) as string[]
  const sectors = (investor?.sector_interests ?? []) as string[]

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {state.error}
        </div>
      )}

      {/* Who */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Who
        </h2>

        <div className="relative">
          <label htmlFor="name" className={labelClass}>
            Investor Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setPartyId('')
              if (mode === 'create') setLinkedName(null)
              setSuggestOpen(true)
            }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setSuggestOpen(false)}
            placeholder="Person or firm, e.g. Wasatch Family Office"
            className={inputClass}
          />
          <input type="hidden" name="party_id" value={partyId} />
          {/* Contact suggestions — mousedown (not click) so it beats input blur */}
          {suggestOpen && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-md overflow-hidden">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickParty(p)
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    <span className="truncate">{p.full_name}</span>
                    {p.company && <span className="text-xs text-muted-foreground truncate">{p.company}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {linkedName ? (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <Link2 size={11} />
              Linked to directory contact: {linkedName}
              {partyId && (
                <button
                  type="button"
                  onClick={() => {
                    setPartyId('')
                    setLinkedName(null)
                  }}
                  className="ml-0.5 hover:text-foreground"
                  aria-label="Remove contact link"
                >
                  <X size={11} />
                </button>
              )}
            </p>
          ) : (
            mode === 'create' && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Pick an existing contact to link it, or a new directory contact is created automatically.
              </p>
            )
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={investor?.email ?? ''}
              placeholder="name@firm.com"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="phone" className={labelClass}>
              Phone
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={investor?.phone ?? ''}
              placeholder="(801) 555-0100"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="investor_type" className={labelClass}>
              Investor Type <span className="text-destructive">*</span>
            </label>
            <select
              id="investor_type"
              name="investor_type"
              required
              defaultValue={investor?.investor_type ?? 'individual'}
              className={inputClass}
            >
              {INVESTOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INVESTOR_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="stage" className={labelClass}>
              Stage
            </label>
            <select
              id="stage"
              name="stage"
              defaultValue={investor?.stage ?? 'identified'}
              className={inputClass}
            >
              {INVESTOR_STAGES.map((s) => (
                <option key={s} value={s}>
                  {INVESTOR_STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="interest_level" className={labelClass}>
              Interest Level
            </label>
            <select
              id="interest_level"
              name="interest_level"
              defaultValue={investor?.interest_level ?? 'warm'}
              className={inputClass}
            >
              {INTEREST_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {INTEREST_LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Capital profile */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Capital Profile
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="check_size_min" className={labelClass}>
              Typical Check — Min ($)
            </label>
            <input
              id="check_size_min"
              name="check_size_min"
              type="number"
              step="any"
              min="0"
              defaultValue={investor?.check_size_min ?? ''}
              placeholder="e.g. 250000"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="check_size_max" className={labelClass}>
              Typical Check — Max ($)
            </label>
            <input
              id="check_size_max"
              name="check_size_max"
              type="number"
              step="any"
              min="0"
              defaultValue={investor?.check_size_max ?? ''}
              placeholder="e.g. 5000000"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className={labelClass}>Preferred Structures</span>
          <div className="flex flex-wrap gap-2">
            {INSTRUMENTS.map((i) => (
              <label
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs cursor-pointer has-checked:border-primary has-checked:bg-primary/5"
              >
                <input
                  type="checkbox"
                  name="preferred_structures"
                  value={i}
                  defaultChecked={structures.includes(i)}
                  className="accent-[var(--primary)]"
                />
                {INSTRUMENT_LABELS[i]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className={labelClass}>Sector Interests</span>
          <div className="flex flex-wrap gap-2">
            {SECTORS.map((s) => (
              <label
                key={s}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs cursor-pointer has-checked:border-primary has-checked:bg-primary/5"
              >
                <input
                  type="checkbox"
                  name="sector_interests"
                  value={s}
                  defaultChecked={sectors.includes(s)}
                  className="accent-[var(--primary)]"
                />
                {SECTOR_LABELS[s]}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* Relationship */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Relationship
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="relationship_owner_id" className={labelClass}>
              Relationship Owner
            </label>
            <select
              id="relationship_owner_id"
              name="relationship_owner_id"
              defaultValue={investor?.relationship_owner_id ?? ''}
              className={inputClass}
            >
              <option value="">—</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="source" className={labelClass}>
              Source
            </label>
            <input
              id="source"
              name="source"
              type="text"
              defaultValue={investor?.source ?? ''}
              placeholder="Referral, banker, event, outbound…"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="referred_by" className={labelClass}>
              Referred By
            </label>
            <input
              id="referred_by"
              name="referred_by"
              type="text"
              defaultValue={investor?.referred_by ?? ''}
              placeholder="Who made the introduction"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="last_contact_date" className={labelClass}>
              Last Contact
            </label>
            <DatePicker
              id="last_contact_date"
              name="last_contact_date"
              defaultValue={investor?.last_contact_date ?? ''}
            />
          </div>

          <div>
            <label htmlFor="next_step" className={labelClass}>
              Next Step
            </label>
            <input
              id="next_step"
              name="next_step"
              type="text"
              defaultValue={investor?.next_step ?? ''}
              placeholder="The single next action"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="next_step_date" className={labelClass}>
              Next Step By
            </label>
            <DatePicker
              id="next_step_date"
              name="next_step_date"
              defaultValue={investor?.next_step_date ?? ''}
            />
          </div>
        </div>

        <div>
          <label htmlFor="notes" className={labelClass}>
            Background Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={investor?.notes ?? ''}
            placeholder="Who they are, what they care about, history with Ber Wilson…"
            className={textareaClass}
          />
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create Investor'
              : 'Save Changes'}
        </Button>
        <Link
          href={cancelHref}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
