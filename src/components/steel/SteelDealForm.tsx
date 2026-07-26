'use client'

import { useState, useRef } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle, Plus, X } from 'lucide-react'
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
  STEEL_PRICE_FLOOR_PER_SQFT,
  effectiveSteelPricePerSqft,
  steelCategory,
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

interface LineInput {
  key: string // stable React key
  id: string // existing row id, or '' for a new line
  description: string
  category: SteelServiceType
  price: string
  cost: string
  commissionable: boolean
  pct: string
  priceTouched: boolean // stops SF×$/SF auto-fill once edited
  costTouched: boolean // stops SF×$20 cost auto-fill once edited
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

  // Line items. Each is a custom row (description + category + price, plus
  // cost/commission for financials users). Edit loads saved lines; create seeds
  // the three common categories (all removable). The first materials line's
  // price auto-fills from SF × $/SF, and its cost from SF × $20, until edited.
  const keyRef = useRef(0)
  const newKey = () => `new-${keyRef.current++}`
  const [lines, setLines] = useState<LineInput[]>(() => {
    if (mode === 'edit' && services.length > 0) {
      return [...services]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((s) => ({
          key: s.id,
          id: s.id,
          description: s.description ?? '',
          category: steelCategory(s.service_type),
          price: s.price != null ? String(s.price) : '',
          cost: s.cost != null ? String(s.cost) : '',
          commissionable: s.commissionable ?? true,
          pct: s.commission_pct != null ? String(s.commission_pct) : '',
          priceTouched: true,
          costTouched: true,
        }))
    }
    return (['materials', 'engineering', 'assembly'] as SteelServiceType[]).map((category, i) => ({
      key: `seed${i}`,
      id: '',
      description: '',
      category,
      price: '',
      cost: '',
      commissionable: true,
      pct: String(DEFAULT_SERVICE_COMMISSION_PCT),
      priceTouched: false,
      costTouched: false,
    }))
  })

  const updateLine = (idx: number, patch: Partial<LineInput>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))
  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        id: '',
        description: '',
        category: 'other',
        price: '',
        cost: '',
        commissionable: true,
        pct: canSeeFinancials ? String(DEFAULT_SERVICE_COMMISSION_PCT) : '',
        priceTouched: false,
        costTouched: false,
      },
    ])

  // SF / $/SF drive the first materials line's price (SF × $/SF) and cost
  // (SF × $20 steel default) until the user edits them.
  function recompute(nextSqft: string, nextPpsf: string) {
    const s = parseFloat(nextSqft.replace(/[,\s]/g, ''))
    const p = parseFloat(nextPpsf.replace(/[$,\s]/g, ''))
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.category === 'materials')
      if (idx === -1) return prev
      const line = prev[idx]
      const nextPrice =
        !line.priceTouched && isFinite(s) && isFinite(p) && s > 0 && p > 0
          ? String(Math.round(s * p * 100) / 100)
          : line.price
      const nextCost =
        !line.costTouched && canSeeFinancials && isFinite(s) && s > 0
          ? String(Math.round(s * DEFAULT_STEEL_COST_PER_SQFT * 100) / 100)
          : line.cost
      if (nextPrice === line.price && nextCost === line.cost) return prev
      return prev.map((l, i) => (i === idx ? { ...l, price: nextPrice, cost: nextCost } : l))
    })
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
  const lineMargin = (l: LineInput): number => parseNum(l.price) - parseNum(l.cost)
  const lineCommission = (l: LineInput): number =>
    l.commissionable ? (lineMargin(l) * parseNum(l.pct)) / 100 : 0
  const totalRevenue = lines.reduce((a, l) => a + parseNum(l.price), 0)
  const totalMargin = lines.reduce((a, l) => a + lineMargin(l), 0)
  const totalCommission = lines.reduce((a, l) => a + lineCommission(l), 0)
  const referralAmount =
    referralType === 'flat'
      ? parseNum(referralValue)
      : referralType === 'percent'
        ? (totalMargin * parseNum(referralValue)) / 100
        : 0

  // Effective steel $/SF for the approval floor: materials-line price ÷ SF (or
  // the entered Price/SF). Warn live when it's under the floor.
  const materialsPrice = lines
    .filter((l) => l.category === 'materials')
    .reduce((a, l) => a + parseNum(l.price), 0)
  const effectivePpsf = effectiveSteelPricePerSqft(materialsPrice, sqftNum, parseNum(ppsf))
  const belowFloor = effectivePpsf != null && effectivePpsf < STEEL_PRICE_FLOOR_PER_SQFT

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
              placeholder="e.g. 45"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Suggests the materials price below. Floor is ${STEEL_PRICE_FLOOR_PER_SQFT}/SF.
            </p>
          </div>
        </div>

        {belowFloor && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Steel is priced at{' '}
              <strong className="tnum">${effectivePpsf!.toFixed(2)}/SF</strong>, below the $
              {STEEL_PRICE_FLOOR_PER_SQFT}/SF floor. This deal will be flagged as needing management
              approval.
            </span>
          </div>
        )}
      </section>

      {/* Line items */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">
          Line Items{canSeeFinancials ? ' & Commission' : ''}
        </h2>
        <p className="-mt-2 text-[11px] text-muted-foreground">
          {canSeeFinancials
            ? 'Add a line for each priced item on the deal. Price − cost = margin; the salesperson earns their % of a commissionable line’s margin. Untick “Commissionable” for pass-through costs (freight, permits) that shouldn’t earn commission. The first Steel line’s price auto-fills from SF × $/SF and its cost from $20/SF until you edit them.'
            : 'Add a line for each priced item on the deal, with its price. Remove any line that isn’t part of this deal.'}
        </p>

        {/* Line count for the server action to iterate. */}
        <input type="hidden" name="line_count" value={lines.length} readOnly />

        <div className="space-y-3">
          {lines.map((line, i) => {
            const margin = lineMargin(line)
            const commission = lineCommission(line)
            const isMaterials = line.category === 'materials'
            return (
              <div key={line.key} className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                <input type="hidden" name={`line_${i}_id`} value={line.id} readOnly />
                {/* Description + category + remove */}
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`line_${i}_description`} className={labelClass}>
                      Description
                    </label>
                    <input
                      id={`line_${i}_description`}
                      name={`line_${i}_description`}
                      type="text"
                      value={line.description}
                      onChange={(e) => updateLine(i, { description: e.target.value })}
                      placeholder={STEEL_SERVICE_LABELS[line.category]}
                      className={inputClass}
                    />
                  </div>
                  <div className="w-40 shrink-0">
                    <label htmlFor={`line_${i}_category`} className={labelClass}>
                      Category
                    </label>
                    <select
                      id={`line_${i}_category`}
                      name={`line_${i}_category`}
                      value={line.category}
                      onChange={(e) => updateLine(i, { category: e.target.value as SteelServiceType })}
                      className={inputClass}
                    >
                      {STEEL_SERVICE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {STEEL_SERVICE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    aria-label="Remove line"
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Money row */}
                <div
                  className={cn(
                    'grid gap-3',
                    canSeeFinancials ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'
                  )}
                >
                  <div>
                    <label htmlFor={`line_${i}_price`} className={labelClass}>
                      Price ($)
                    </label>
                    <input
                      id={`line_${i}_price`}
                      name={`line_${i}_price`}
                      type="number"
                      step="any"
                      min="0"
                      value={line.price}
                      onChange={(e) => updateLine(i, { price: e.target.value, priceTouched: true })}
                      placeholder={isMaterials ? 'Auto from SF × $/SF' : '0'}
                      className={inputClass}
                    />
                  </div>
                  {canSeeFinancials && (
                    <>
                      <div>
                        <label htmlFor={`line_${i}_cost`} className={labelClass}>
                          Cost ($)
                        </label>
                        <input
                          id={`line_${i}_cost`}
                          name={`line_${i}_cost`}
                          type="number"
                          step="any"
                          min="0"
                          value={line.cost}
                          onChange={(e) => updateLine(i, { cost: e.target.value, costTouched: true })}
                          placeholder={isMaterials ? 'Auto from $20/SF' : 'Our cost'}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label htmlFor={`line_${i}_commission_pct`} className={labelClass}>
                          Commission %
                        </label>
                        <input
                          id={`line_${i}_commission_pct`}
                          name={`line_${i}_commission_pct`}
                          type="number"
                          step="any"
                          min="0"
                          value={line.pct}
                          onChange={(e) => updateLine(i, { pct: e.target.value })}
                          disabled={!line.commissionable}
                          placeholder="% of margin"
                          className={cn(inputClass, !line.commissionable && 'opacity-50')}
                        />
                      </div>
                      <div className="flex flex-col justify-end pb-0.5">
                        <p className="text-[11px] text-muted-foreground">Margin</p>
                        <p className="text-sm font-medium tnum">{formatValue(margin)}</p>
                        {commission !== 0 && (
                          <p className="text-[11px] text-muted-foreground tnum">
                            comm {formatValue(commission)}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {canSeeFinancials && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      name={`line_${i}_commissionable`}
                      checked={line.commissionable}
                      onChange={(e) => updateLine(i, { commissionable: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-input"
                    />
                    Commissionable (margin earns commission)
                  </label>
                )}
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus size={13} />
          Add line item
        </button>

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
