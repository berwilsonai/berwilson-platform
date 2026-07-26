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
  STEEL_SERVICE_TYPES,
  STEEL_SERVICE_LABELS,
  REFERRAL_FEE_TYPES,
  REFERRAL_FEE_LABELS,
  DEFAULT_SERVICE_COMMISSION_PCT,
  DEFAULT_STEEL_COST_PER_SQFT,
  isPerSqftCostService,
  type SteelServiceType,
} from '@/lib/utils/steel'
import type { SteelDealService } from '@/lib/supabase/types'

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
  /** Existing service lines (edit mode). */
  services?: SteelDealService[]
  /** Cost/margin/commission/referral are shown only to admin/executive. */
  canSeeFinancials?: boolean
}

interface ServiceInput {
  price: string
  /** Manual dollar cost — used for engineering only. */
  cost: string
  /** Cost basis $/SF — used for materials & assembly (drives the dollar cost). */
  costPerSqft: string
  pct: string
}

export default function SteelDealForm({
  mode,
  deal,
  teamMembers,
  leadSources = [],
  services = [],
  canSeeFinancials = true,
}: SteelDealFormProps) {
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

  const [sqft, setSqft] = useState(deal?.square_feet != null ? String(deal.square_feet) : '')
  const [ppsf, setPpsf] = useState(deal?.price_per_sqft != null ? String(deal.price_per_sqft) : '')

  // Per-service price/cost/commission. Materials price auto-fills from
  // sqft × $/SF until the user types their own number. Materials & assembly
  // cost is driven by a cost basis ($/SF); engineering cost is manual.
  const initService = (type: SteelServiceType): ServiceInput => {
    const s = services.find((x) => x.service_type === type)
    // Cost basis $/SF: stored value wins; else back-compute from an existing
    // dollar cost; else default $20 for materials on a new deal.
    let costPerSqft = ''
    if (isPerSqftCostService(type)) {
      if (s?.cost_per_sqft != null) {
        costPerSqft = String(s.cost_per_sqft)
      } else if (s?.cost != null && deal?.square_feet) {
        costPerSqft = String(Math.round((s.cost / deal.square_feet) * 10000) / 10000)
      } else if (type === 'materials' && mode === 'create') {
        costPerSqft = String(DEFAULT_STEEL_COST_PER_SQFT)
      }
    }
    return {
      price: s?.price != null ? String(s.price) : '',
      cost: s?.cost != null ? String(s.cost) : '',
      costPerSqft,
      pct:
        s?.commission_pct != null
          ? String(s.commission_pct)
          : mode === 'create'
            ? String(DEFAULT_SERVICE_COMMISSION_PCT)
            : '',
    }
  }
  const [svc, setSvc] = useState<Record<SteelServiceType, ServiceInput>>({
    materials: initService('materials'),
    engineering: initService('engineering'),
    assembly: initService('assembly'),
  })
  const [materialsPriceTouched, setMaterialsPriceTouched] = useState(
    mode === 'edit' && services.some((s) => s.service_type === 'materials' && s.price != null)
  )

  const setService = (type: SteelServiceType, patch: Partial<ServiceInput>) =>
    setSvc((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }))

  function recompute(nextSqft: string, nextPpsf: string) {
    if (materialsPriceTouched) return
    const s = parseFloat(nextSqft.replace(/[,\s]/g, ''))
    const p = parseFloat(nextPpsf.replace(/[$,\s]/g, ''))
    const next = isFinite(s) && isFinite(p) && s > 0 && p > 0 ? String(Math.round(s * p * 100) / 100) : ''
    setService('materials', { price: next })
  }

  const [referralType, setReferralType] = useState(deal?.referral_fee_type ?? 'none')
  const [referralValue, setReferralValue] = useState(
    deal?.referral_fee_value != null ? String(deal.referral_fee_value) : ''
  )

  const parseNum = (raw: string): number => {
    const n = parseFloat(raw.replace(/[$,\s]/g, ''))
    return isFinite(n) ? n : 0
  }
  const sqftNum = parseNum(sqft)
  // Effective dollar cost: per-SF services = SF × basis; engineering = manual.
  const rowCost = (type: SteelServiceType): number =>
    isPerSqftCostService(type) ? sqftNum * parseNum(svc[type].costPerSqft) : parseNum(svc[type].cost)
  const totalRevenue = STEEL_SERVICE_TYPES.reduce((a, t) => a + parseNum(svc[t].price), 0)
  const totalMargin = STEEL_SERVICE_TYPES.reduce(
    (a, t) => a + (parseNum(svc[t].price) - rowCost(t)),
    0
  )
  const totalCommission = STEEL_SERVICE_TYPES.reduce(
    (a, t) => a + ((parseNum(svc[t].price) - rowCost(t)) * parseNum(svc[t].pct)) / 100,
    0
  )
  const referralAmount =
    referralType === 'flat'
      ? parseNum(referralValue)
      : referralType === 'percent'
        ? (totalMargin * parseNum(referralValue)) / 100
        : 0

  const cancelHref = mode === 'edit' && deal ? `/steel/${deal.id}` : '/steel'

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

      {/* Building size */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Building Size
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <p className="mt-1 text-[11px] text-muted-foreground">Suggests the materials price below.</p>
          </div>
        </div>
      </section>

      {/* Services & commission */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Services{canSeeFinancials ? ' & Commission' : ''}
        </h2>
        <p className="-mt-2 text-[11px] text-muted-foreground">
          {canSeeFinancials
            ? 'Price − cost = margin; the salesperson earns their % of each service’s margin. Steel & frame-assembly cost is a per-SF basis (steel defaults to $20/SF, so cost = square feet × basis); engineering cost is entered per deal. Leave a service blank if it isn’t part of this deal.'
            : 'Enter the price for each service on this deal. Leave a service blank if it isn’t part of this deal.'}
        </p>

        <div className="space-y-3">
          {STEEL_SERVICE_TYPES.map((type) => {
            const row = svc[type]
            const perSqft = isPerSqftCostService(type)
            const costDollars = rowCost(type)
            const margin = parseNum(row.price) - costDollars
            const commission = (margin * parseNum(row.pct)) / 100
            return (
              <div key={type} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium">{STEEL_SERVICE_LABELS[type]}</p>
                <div
                  className={cn(
                    'grid gap-3',
                    canSeeFinancials ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'
                  )}
                >
                  <div>
                    <label htmlFor={`svc_${type}_price`} className={labelClass}>
                      Price ($)
                    </label>
                    <input
                      id={`svc_${type}_price`}
                      name={`svc_${type}_price`}
                      type="number"
                      step="any"
                      min="0"
                      value={row.price}
                      onChange={(e) => {
                        setService(type, { price: e.target.value })
                        if (type === 'materials') setMaterialsPriceTouched(e.target.value.trim() !== '')
                      }}
                      placeholder={type === 'materials' ? 'Auto from SF × $/SF' : '0'}
                      className={inputClass}
                    />
                  </div>
                  {canSeeFinancials && (
                    <>
                      <div>
                        {perSqft ? (
                          <>
                            <label htmlFor={`svc_${type}_cost_per_sqft`} className={labelClass}>
                              Cost / SF ($)
                            </label>
                            <input
                              id={`svc_${type}_cost_per_sqft`}
                              name={`svc_${type}_cost_per_sqft`}
                              type="number"
                              step="any"
                              min="0"
                              value={row.costPerSqft}
                              onChange={(e) => setService(type, { costPerSqft: e.target.value })}
                              placeholder={type === 'materials' ? 'e.g. 20' : 'Cost per SF'}
                              className={inputClass}
                            />
                          </>
                        ) : (
                          <>
                            <label htmlFor={`svc_${type}_cost`} className={labelClass}>
                              Cost ($)
                            </label>
                            <input
                              id={`svc_${type}_cost`}
                              name={`svc_${type}_cost`}
                              type="number"
                              step="any"
                              min="0"
                              value={row.cost}
                              onChange={(e) => setService(type, { cost: e.target.value })}
                              placeholder="Paid to engineer"
                              className={inputClass}
                            />
                          </>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`svc_${type}_commission_pct`} className={labelClass}>
                          Commission %
                        </label>
                        <input
                          id={`svc_${type}_commission_pct`}
                          name={`svc_${type}_commission_pct`}
                          type="number"
                          step="any"
                          min="0"
                          value={row.pct}
                          onChange={(e) => setService(type, { pct: e.target.value })}
                          placeholder="% of margin"
                          className={inputClass}
                        />
                      </div>
                      <div className="flex flex-col justify-end pb-0.5">
                        <p className="text-[11px] text-muted-foreground">Margin</p>
                        <p className="text-sm font-medium tnum">{formatValue(margin)}</p>
                        {perSqft && costDollars > 0 && (
                          <p className="text-[11px] text-muted-foreground tnum">
                            cost {formatValue(costDollars)}
                          </p>
                        )}
                        {commission !== 0 && (
                          <p className="text-[11px] text-muted-foreground tnum">
                            comm {formatValue(commission)}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border px-3 py-2 text-xs">
          <span>
            Contract value <strong className="tnum">{formatValue(totalRevenue)}</strong>
          </span>
          {canSeeFinancials && (
            <>
              <span>
                Margin <strong className="tnum">{formatValue(totalMargin)}</strong>
              </span>
              <span>
                Salesperson comm <strong className="tnum">{formatValue(totalCommission)}</strong>
              </span>
              {referralAmount > 0 && (
                <span>
                  Referral <strong className="tnum">{formatValue(referralAmount)}</strong>
                </span>
              )}
            </>
          )}
        </div>
      </section>

      {/* Referral fee — financials only */}
      {canSeeFinancials && (
        <section className="space-y-4">
          <h2 className="label-caps text-muted-foreground">Referral Fee</h2>
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Paid to the “Referred By” person (set under Lead Source). A flat amount or a % of the deal’s
            total margin.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="referral_fee_type" className={labelClass}>
                Type
              </label>
              <select
                id="referral_fee_type"
                name="referral_fee_type"
                value={referralType}
                onChange={(e) => setReferralType(e.target.value)}
                className={inputClass}
              >
                {REFERRAL_FEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {REFERRAL_FEE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            {referralType !== 'none' && (
              <div>
                <label htmlFor="referral_fee_value" className={labelClass}>
                  {referralType === 'flat' ? 'Amount ($)' : 'Percent (%)'}
                </label>
                <input
                  id="referral_fee_value"
                  name="referral_fee_value"
                  type="number"
                  step="any"
                  min="0"
                  value={referralValue}
                  onChange={(e) => setReferralValue(e.target.value)}
                  placeholder={referralType === 'flat' ? 'e.g. 2500' : 'e.g. 5'}
                  className={inputClass}
                />
                {referralAmount > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground tnum">= {formatValue(referralAmount)}</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

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
            <label htmlFor="lead_source_id" className={labelClass}>
              Referred By
            </label>
            <select
              id="lead_source_id"
              name="lead_source_id"
              defaultValue={deal?.lead_source_id ?? ''}
              className={inputClass}
            >
              <option value="">— channel / not a person</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The person who brought the deal (add them under Users). Leave blank
              for channels like Trade Show. Commission-payable later.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="lead_source_detail" className={labelClass}>
              Source Detail
            </label>
            <input
              id="lead_source_detail"
              name="lead_source_detail"
              type="text"
              defaultValue={deal?.lead_source_detail ?? ''}
              placeholder="A firm not in Users, or any extra context"
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
