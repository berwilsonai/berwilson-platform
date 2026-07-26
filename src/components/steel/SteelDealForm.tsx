'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { createSteelDeal, updateSteelDeal } from '@/app/steel/actions'
import type { SteelDealFormState } from '@/app/steel/actions'
import type { SteelDeal } from '@/lib/supabase/types'
import { formatValue } from '@/lib/utils/constants'
import {
  STEEL_STAGES,
  STEEL_STAGE_LABELS,
  DEFAULT_LEAD_SOURCES,
  leadSourceLabel,
} from '@/lib/utils/steel'

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

interface SteelDealFormProps {
  mode: 'create' | 'edit'
  deal?: SteelDeal
  teamMembers: { id: string; name: string }[]
  /** Lead sources already in use — merged with the defaults for suggestions. */
  leadSources?: string[]
}

/** Live dollar readback under a raw number input — catches magnitude typos. */
function moneyReadback(raw: string): string | null {
  const parsed = parseFloat(raw.replace(/[$,\s]/g, ''))
  if (!isFinite(parsed) || parsed <= 0) return null
  return `= ${formatValue(parsed)}`
}

export default function SteelDealForm({ mode, deal, teamMembers, leadSources = [] }: SteelDealFormProps) {
  // Suggestions = sources in use + the defaults, deduped case-insensitively
  // (in-use casing wins so the vocabulary stays consistent).
  const sourceOptions: string[] = []
  const seen = new Set<string>()
  for (const s of [...leadSources, ...DEFAULT_LEAD_SOURCES]) {
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sourceOptions.push(s)
  }

  const action =
    mode === 'edit' && deal
      ? updateSteelDeal.bind(null, deal.id)
      : createSteelDeal

  const [state, formAction, isPending] = useActionState<SteelDealFormState, FormData>(action, null)

  // Contract value auto-computes from sqft × $/SF until the user types their
  // own number (a negotiated total can differ from the arithmetic).
  const [sqft, setSqft] = useState(deal?.square_feet != null ? String(deal.square_feet) : '')
  const [ppsf, setPpsf] = useState(deal?.price_per_sqft != null ? String(deal.price_per_sqft) : '')
  const [value, setValue] = useState(deal?.value != null ? String(deal.value) : '')
  const [valueTouched, setValueTouched] = useState(mode === 'edit' && deal?.value != null)

  function recompute(nextSqft: string, nextPpsf: string) {
    if (valueTouched) return
    const s = parseFloat(nextSqft.replace(/[,\s]/g, ''))
    const p = parseFloat(nextPpsf.replace(/[$,\s]/g, ''))
    if (isFinite(s) && isFinite(p) && s > 0 && p > 0) {
      setValue(String(Math.round(s * p * 100) / 100))
    } else {
      setValue('')
    }
  }

  const cancelHref = mode === 'edit' && deal ? `/steel/${deal.id}` : '/steel'
  const valueHint = moneyReadback(value)

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {state?.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {state.error}
        </div>
      )}

      {/* Deal */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Deal
        </h2>

        <div>
          <label htmlFor="name" className={labelClass}>
            Deal Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={deal?.name ?? ''}
            placeholder="e.g. Riverton warehouse shell"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="customer" className={labelClass}>
              Customer
            </label>
            <input
              id="customer"
              name="customer"
              type="text"
              defaultValue={deal?.customer ?? ''}
              placeholder="Who's buying"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="building_type" className={labelClass}>
              Building Type
            </label>
            <input
              id="building_type"
              name="building_type"
              type="text"
              defaultValue={deal?.building_type ?? ''}
              placeholder="Warehouse, hangar, ag building…"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="stage" className={labelClass}>
              Stage
            </label>
            <select
              id="stage"
              name="stage"
              defaultValue={deal?.stage ?? 'quote'}
              className={inputClass}
            >
              {STEEL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STEEL_STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="salesperson_id" className={labelClass}>
              Salesperson
            </label>
            <select
              id="salesperson_id"
              name="salesperson_id"
              defaultValue={deal?.salesperson_id ?? ''}
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
        </div>
      </section>

      {/* Size & price */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Size & Price
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="square_feet" className={labelClass}>
              Square Feet
            </label>
            <input
              id="square_feet"
              name="square_feet"
              type="number"
              step="any"
              min="0"
              value={sqft}
              onChange={(e) => {
                setSqft(e.target.value)
                recompute(e.target.value, ppsf)
              }}
              placeholder="e.g. 40000"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="price_per_sqft" className={labelClass}>
              Price / SF ($)
            </label>
            <input
              id="price_per_sqft"
              name="price_per_sqft"
              type="number"
              step="any"
              min="0"
              value={ppsf}
              onChange={(e) => {
                setPpsf(e.target.value)
                recompute(sqft, e.target.value)
              }}
              placeholder="e.g. 24.50"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="value" className={labelClass}>
              Contract Value ($)
            </label>
            <input
              id="value"
              name="value"
              type="number"
              step="any"
              min="0"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setValueTouched(e.target.value.trim() !== '')
              }}
              placeholder="Auto from SF × $/SF"
              className={inputClass}
            />
            {valueHint && <p className="mt-1 text-[11px] text-muted-foreground tnum">{valueHint}</p>}
          </div>
        </div>
      </section>

      {/* Source */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Lead Source
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lead_source" className={labelClass}>
              Source
            </label>
            <input
              id="lead_source"
              name="lead_source"
              type="text"
              list="lead-source-options"
              defaultValue={deal ? leadSourceLabel(deal.lead_source) : ''}
              placeholder="Pick or type a new one"
              className={inputClass}
            />
            <datalist id="lead-source-options">
              {sourceOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-muted-foreground">
              New sources are saved and suggested next time.
            </p>
          </div>
          <div>
            <label htmlFor="lead_source_detail" className={labelClass}>
              Source Detail
            </label>
            <input
              id="lead_source_detail"
              name="lead_source_detail"
              type="text"
              defaultValue={deal?.lead_source_detail ?? ''}
              placeholder="The specific person or firm"
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* Timeline & next step */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Timeline
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="expected_delivery_date" className={labelClass}>
              Expected Delivery
            </label>
            <DatePicker
              id="expected_delivery_date"
              name="expected_delivery_date"
              defaultValue={deal?.expected_delivery_date ?? ''}
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
              defaultValue={deal?.next_step ?? ''}
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
              defaultValue={deal?.next_step_date ?? ''}
            />
          </div>
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            Scope & Notes
          </label>
          <textarea
            id="description"
            name="description"
            defaultValue={deal?.description ?? ''}
            placeholder="Scope, specs, site details, history…"
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
              ? 'Create Deal'
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
