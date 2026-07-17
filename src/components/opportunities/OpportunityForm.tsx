'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { createOpportunity, updateOpportunity } from '@/app/opportunities/actions'
import type { OpportunityFormState } from '@/app/opportunities/actions'
import type { Opportunity } from '@/lib/supabase/types'
import { SECTORS, SECTOR_LABELS } from '@/lib/utils/constants'
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_PRIORITIES,
  OPPORTUNITY_PRIORITY_LABELS,
} from '@/lib/utils/opportunities'

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

interface OpportunityFormProps {
  mode: 'create' | 'edit'
  opportunity?: Opportunity
}

export default function OpportunityForm({ mode, opportunity }: OpportunityFormProps) {
  const action =
    mode === 'edit' && opportunity
      ? updateOpportunity.bind(null, opportunity.id)
      : createOpportunity

  const [state, formAction, isPending] = useActionState<OpportunityFormState, FormData>(action, null)

  const cancelHref = mode === 'edit' && opportunity ? `/opportunities/${opportunity.id}` : '/opportunities'

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {/* Error banner */}
      {state?.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {state.error}
        </div>
      )}

      {/* Core info */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Core Info
        </h2>

        <div>
          <label htmlFor="name" className={labelClass}>
            Opportunity Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={opportunity?.name ?? ''}
            placeholder="e.g. Acquire Mountain Steel Fabricators"
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="opp_type" className={labelClass}>
              Type <span className="text-destructive">*</span>
            </label>
            <select
              id="opp_type"
              name="opp_type"
              required
              defaultValue={opportunity?.opp_type ?? 'acquisition'}
              className={inputClass}
            >
              {OPPORTUNITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {OPPORTUNITY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={opportunity?.status ?? 'identified'}
              className={inputClass}
            >
              {OPPORTUNITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OPPORTUNITY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="priority" className={labelClass}>
              Priority
            </label>
            <select
              id="priority"
              name="priority"
              defaultValue={opportunity?.priority ?? 'medium'}
              className={inputClass}
            >
              {OPPORTUNITY_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {OPPORTUNITY_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <textarea
            id="description"
            name="description"
            defaultValue={opportunity?.description ?? ''}
            placeholder="What is this opportunity, in plain language?"
            className={textareaClass}
          />
        </div>
      </section>

      {/* Strategy */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Strategy
        </h2>

        <div>
          <label htmlFor="objective" className={labelClass}>
            Objective <span className="font-normal text-muted-foreground">(what we want to achieve)</span>
          </label>
          <textarea
            id="objective"
            name="objective"
            defaultValue={opportunity?.objective ?? ''}
            placeholder="e.g. Add in-house steel fab capacity in the Mountain West and lock up a recurring prefab supplier."
            className={textareaClass}
          />
        </div>

        <div>
          <label htmlFor="thesis" className={labelClass}>
            Strategic Thesis <span className="font-normal text-muted-foreground">(why it fits Ber Wilson)</span>
          </label>
          <textarea
            id="thesis"
            name="thesis"
            defaultValue={opportunity?.thesis ?? ''}
            placeholder="Vertical integration, margin capture, federal qualification, geographic reach…"
            className={textareaClass}
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
            defaultValue={opportunity?.next_step ?? ''}
            placeholder="The single next action"
            className={inputClass}
          />
        </div>
      </section>

      {/* Counterparty & Deal */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Counterparty & Deal
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="target_name" className={labelClass}>
              Target / Company
            </label>
            <input
              id="target_name"
              name="target_name"
              type="text"
              defaultValue={opportunity?.target_name ?? ''}
              placeholder="The company or asset"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="counterparty" className={labelClass}>
              Counterparty
            </label>
            <input
              id="counterparty"
              name="counterparty"
              type="text"
              defaultValue={opportunity?.counterparty ?? ''}
              placeholder="Who we're negotiating with"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="estimated_value" className={labelClass}>
              Estimated Value ($)
            </label>
            <input
              id="estimated_value"
              name="estimated_value"
              type="number"
              step="any"
              min="0"
              defaultValue={opportunity?.estimated_value ?? ''}
              placeholder="0"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="ownership_stake" className={labelClass}>
              Ownership Stake (%)
            </label>
            <input
              id="ownership_stake"
              name="ownership_stake"
              type="number"
              step="any"
              min="0"
              max="100"
              defaultValue={opportunity?.ownership_stake ?? ''}
              placeholder="0–100"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="probability" className={labelClass}>
              Probability (%)
            </label>
            <input
              id="probability"
              name="probability"
              type="number"
              min="0"
              max="100"
              step="1"
              defaultValue={opportunity?.probability ?? ''}
              placeholder="0–100"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="deal_structure" className={labelClass}>
              Deal Structure
            </label>
            <input
              id="deal_structure"
              name="deal_structure"
              type="text"
              defaultValue={opportunity?.deal_structure ?? ''}
              placeholder="Asset purchase, stock purchase, equity stake, earnout…"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="source" className={labelClass}>
              Source
            </label>
            <input
              id="source"
              name="source"
              type="text"
              defaultValue={opportunity?.source ?? ''}
              placeholder="Inbound, banker, referral, outbound…"
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* Context */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Context
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="sector" className={labelClass}>
              Sector
            </label>
            <select
              id="sector"
              name="sector"
              defaultValue={opportunity?.sector ?? ''}
              className={inputClass}
            >
              <option value="">—</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {SECTOR_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="location" className={labelClass}>
              Location
            </label>
            <input
              id="location"
              name="location"
              type="text"
              defaultValue={opportunity?.location ?? ''}
              placeholder="e.g. Boise, ID"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="lead" className={labelClass}>
              Lead
            </label>
            <input
              id="lead"
              name="lead"
              type="text"
              defaultValue={opportunity?.lead ?? ''}
              placeholder="Who owns this pursuit"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="website" className={labelClass}>
            Website
          </label>
          <input
            id="website"
            name="website"
            type="text"
            defaultValue={opportunity?.website ?? ''}
            placeholder="https://…"
            className={inputClass}
          />
        </div>
      </section>

      {/* Key Dates */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Key Dates
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="identified_date" className={labelClass}>
              Identified
            </label>
            <DatePicker
              id="identified_date"
              name="identified_date"
              defaultValue={opportunity?.identified_date ?? ''}
            />
          </div>

          <div>
            <label htmlFor="target_close_date" className={labelClass}>
              Target Close
            </label>
            <DatePicker
              id="target_close_date"
              name="target_close_date"
              defaultValue={opportunity?.target_close_date ?? ''}
            />
          </div>
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
              ? 'Create Opportunity'
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
