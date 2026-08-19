'use client'

import { useState, useRef, useMemo, useEffect } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle, Plus, X, Search, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { createSteelDeal, updateSteelDeal } from '@/app/steel/actions'
import type { SteelDealFormState } from '@/app/steel/actions'
import type { SteelDeal, SteelDealService } from '@/lib/supabase/types'
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
  DEFAULT_STEEL_COST_PER_SQFT,
  STEEL_PRICE_FLOOR_PER_SQFT,
  INSTALL_FEE_MIN,
  INSTALL_FEE_MAX,
  DEFAULT_ICP_SEGMENTS,
  DEFAULT_BUYING_TRIGGERS,
  effectiveSteelPricePerSqft,
  steelCategory,
  steelSizeTier,
  SIZE_TIER_LABELS,
  SALES_RATE_BY_TIER,
  salesRate,
  commissionableMargin,
  isInstallCategory,
  type SteelServiceType,
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

interface SourceContact {
  id: string
  full_name: string
  company: string | null
  is_organization: boolean | null
}

interface SteelDealFormProps {
  mode: 'create' | 'edit'
  deal?: SteelDeal
  /** Steel sales reps only — the Salesperson list (Colton, Richard, Eric, Jason). */
  reps: { id: string; name: string }[]
  /** The whole contacts directory — the Marketing / Referral Source can be any of them. */
  contacts?: SourceContact[]
  /** The deal's current marketing/referral source (edit prefill, may be archived). */
  referralSource?: { id: string; full_name: string } | null
  /** Lead sources already in use — merged with the defaults for suggestions. */
  leadSources?: string[]
  /** Existing service lines (edit mode). */
  services?: SteelDealService[]
  /** Cost/margin/rate/referral controls are shown only to admin/executive. */
  canSeeFinancials?: boolean
  /**
   * When set, the form stays in place on save (no navigation): the server
   * action returns the saved id and this fires so the host (a drawer) can close
   * and refresh. Also swaps Cancel from a link to a button.
   */
  onSaved?: (id: string) => void
  /** Cancel handler for embedded (drawer) mode — closes without navigating. */
  onCancel?: () => void
}

/** Type-ahead over the contacts directory to pick a marketing / referral source. */
function SourcePicker({
  contacts,
  selected,
  onSelect,
  onClear,
}: {
  contacts: SourceContact[]
  selected: { id: string; full_name: string } | null
  onSelect: (c: { id: string; full_name: string }) => void
  onClear: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return contacts
      .filter((c) => c.full_name.toLowerCase().includes(s) || (c.company ?? '').toLowerCase().includes(s))
      .slice(0, 8)
  }, [q, contacts])

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
        <span className="truncate">{selected.full_name}</span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear source"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search contacts…"
        className={cn(inputClass, 'pl-8')}
      />
      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-56 overflow-auto py-1">
          {options.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect({ id: c.id, full_name: c.full_name })
                  setQ('')
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Building2 size={13} className={cn('shrink-0', c.is_organization ? 'text-foreground' : 'text-muted-foreground')} />
                <span className="truncate">{c.full_name}</span>
                {c.company && <span className="truncate text-xs text-muted-foreground">· {c.company}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface LineInput {
  key: string // stable React key
  id: string // existing row id, or '' for a new line
  description: string
  category: SteelServiceType
  price: string
  cost: string
  commissionable: boolean
  priceTouched: boolean // stops SF×$/SF auto-fill once edited
  costTouched: boolean // stops SF×$20 cost auto-fill once edited
}

export default function SteelDealForm({
  mode,
  deal,
  reps,
  contacts = [],
  referralSource = null,
  leadSources = [],
  services = [],
  canSeeFinancials = true,
  onSaved,
  onCancel,
}: SteelDealFormProps) {
  // Suggestions = sources in use + the defaults, deduped case-insensitively.
  const sourceOptions: string[] = []
  const seen = new Set<string>()
  for (const s of [...leadSources, ...DEFAULT_LEAD_SOURCES]) {
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sourceOptions.push(s)
  }

  const action = mode === 'edit' && deal ? updateSteelDeal.bind(null, deal.id) : createSteelDeal
  const [state, formAction, isPending] = useActionState<SteelDealFormState, FormData>(action, null)

  // Embedded (drawer) mode: the action returns `{ ok, id }` instead of
  // navigating; hand it back to the host once, then it unmounts us.
  const savedRef = useRef(false)
  useEffect(() => {
    if (state && 'ok' in state && !savedRef.current) {
      savedRef.current = true
      onSaved?.(state.id)
    }
  }, [state, onSaved])

  const [sqft, setSqft] = useState(deal?.square_feet != null ? String(deal.square_feet) : '')
  const [ppsf, setPpsf] = useState(deal?.price_per_sqft != null ? String(deal.price_per_sqft) : '')

  // Marketing / referral source — any contact. Hidden input carries the id.
  const [source, setSource] = useState<{ id: string; full_name: string } | null>(referralSource)

  // Deal-level commission controls (financials users only). Override is blank
  // by default → the SF-tier rate is used.
  const [salesRateOverride, setSalesRateOverride] = useState(
    deal?.sales_rate_override != null ? String(deal.sales_rate_override) : ''
  )
  const [installFee, setInstallFee] = useState(deal?.install_fee != null ? String(deal.install_fee) : '')

  // Line items. Edit loads saved lines; create seeds the three common
  // categories (all removable). The first materials line's price auto-fills
  // from SF × $/SF, and its cost from SF × $20, until edited.
  const keyRef = useRef(0)
  const newKey = () => `new-${keyRef.current++}`
  const [lines, setLines] = useState<LineInput[]>(() => {
    if (mode === 'edit' && services.length > 0) {
      // The first materials line stays auto-derivable (untouched) when its
      // stored price still equals SF × $/SF and its cost equals SF × $20 — so
      // editing Square Feet / Price-per-SF above recomputes it. A hand-edited
      // value no longer matches, so it's kept exactly as typed.
      const sf = deal?.square_feet ?? 0
      const pp = deal?.price_per_sqft ?? 0
      const derivedPrice = sf > 0 && pp > 0 ? Math.round(sf * pp * 100) / 100 : null
      const derivedCost = sf > 0 ? Math.round(sf * DEFAULT_STEEL_COST_PER_SQFT * 100) / 100 : null
      let firstMaterials = true
      return [...services]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((s) => {
          const category = steelCategory(s.service_type)
          const isFirstMaterials = category === 'materials' && firstMaterials
          if (isFirstMaterials) firstMaterials = false
          const priceIsDerived =
            isFirstMaterials && derivedPrice != null && s.price != null && Number(s.price) === derivedPrice
          const costIsDerived =
            isFirstMaterials && derivedCost != null && s.cost != null && Number(s.cost) === derivedCost
          return {
            key: s.id,
            id: s.id,
            description: s.description ?? '',
            category,
            price: s.price != null ? String(s.price) : '',
            cost: s.cost != null ? String(s.cost) : '',
            commissionable: s.commissionable ?? true,
            priceTouched: !priceIsDerived,
            costTouched: !costIsDerived,
          }
        })
    }
    return (['materials', 'engineering', 'assembly'] as SteelServiceType[]).map((category, i) => ({
      key: `seed${i}`,
      id: '',
      description: '',
      category,
      price: '',
      cost: '',
      commissionable: true,
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
  const overrideNum = (raw: string): number | null => {
    const t = raw.trim()
    if (t === '') return null
    const n = parseFloat(t.replace(/[%,\s]/g, ''))
    return isFinite(n) ? n : null
  }
  const sqftNum = parseNum(sqft)
  const lineMargin = (l: LineInput): number => parseNum(l.price) - parseNum(l.cost)
  const totalRevenue = lines.reduce((a, l) => a + parseNum(l.price), 0)
  const totalMargin = lines.reduce((a, l) => a + lineMargin(l), 0)

  // Live commission preview using the founding-phase comp plan.
  const lineObjs = lines.map((l) => ({
    service_type: l.category,
    price: parseNum(l.price),
    cost: parseNum(l.cost),
    commissionable: l.commissionable,
  }))
  const cMargin = commissionableMargin(lineObjs)
  const tier = steelSizeTier(sqftNum)
  const effSalesRate = salesRate(sqftNum, overrideNum(salesRateOverride))
  const salesComm = (cMargin * effSalesRate) / 100
  const installFeeNum = parseNum(installFee)
  const referralAmount =
    referralType === 'flat'
      ? parseNum(referralValue)
      : referralType === 'percent'
        ? (totalMargin * parseNum(referralValue)) / 100
        : 0

  // Effective steel $/SF for the approval floor: materials-line price ÷ SF.
  const materialsPrice = lines
    .filter((l) => l.category === 'materials')
    .reduce((a, l) => a + parseNum(l.price), 0)
  const effectivePpsf = effectiveSteelPricePerSqft(materialsPrice, sqftNum, parseNum(ppsf))
  const belowFloor = effectivePpsf != null && effectivePpsf < STEEL_PRICE_FLOOR_PER_SQFT

  const cancelHref = mode === 'edit' && deal ? `/steel/${deal.id}` : '/steel'

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {onSaved && <input type="hidden" name="_stay" value="1" readOnly />}
      {state && 'error' in state && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {state.error}
        </div>
      )}

      {/* Deal */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">Deal</h2>

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
            <label htmlFor="icp_segment" className={labelClass}>
              Buyer Segment
            </label>
            <input
              id="icp_segment"
              name="icp_segment"
              type="text"
              list="icp-segment-options"
              defaultValue={deal?.icp_segment ?? ''}
              placeholder="Developer, GC, Owner-Builder…"
              className={inputClass}
            />
            <datalist id="icp-segment-options">
              {DEFAULT_ICP_SEGMENTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="buying_trigger" className={labelClass}>
              Buying Trigger
            </label>
            <input
              id="buying_trigger"
              name="buying_trigger"
              type="text"
              list="buying-trigger-options"
              defaultValue={deal?.buying_trigger ?? ''}
              placeholder="New construction, expansion…"
              className={inputClass}
            />
            <datalist id="buying-trigger-options">
              {DEFAULT_BUYING_TRIGGERS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="stage" className={labelClass}>
              Stage
            </label>
            <select id="stage" name="stage" defaultValue={deal?.stage ?? 'quote'} className={inputClass}>
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
            <select id="salesperson_id" name="salesperson_id" defaultValue={deal?.salesperson_id ?? ''} className={inputClass}>
              <option value="">—</option>
              {reps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">Earns the sales rate + install fee.</p>
          </div>
        </div>
      </section>

      {/* Building size */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">Building Size</h2>

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
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sets the commission rate tier: {SIZE_TIER_LABELS[tier]}.
            </p>
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
              Steel is priced at <strong className="tnum">${effectivePpsf!.toFixed(2)}/SF</strong>, below the $
              {STEEL_PRICE_FLOOR_PER_SQFT}/SF floor. This deal will be flagged as needing management approval.
            </span>
          </div>
        )}
      </section>

      {/* Line items */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">Line Items</h2>
        <p className="-mt-2 text-[11px] text-muted-foreground">
          {canSeeFinancials
            ? 'Add a line for each priced item. Price − cost = margin. Commission is earned on the deal’s total commissionable margin at the rate set by project size (below). Installation / frame-assembly lines are billed separately and earn the flat install fee, not margin commission. Untick “Commissionable” for pass-through costs (freight, permits). The first Steel line auto-fills from SF × $/SF (cost $20/SF).'
            : 'Add a line for each priced item on the deal, with its price. Remove any line that isn’t part of this deal.'}
        </p>

        <input type="hidden" name="line_count" value={lines.length} readOnly />

        <div className="space-y-3">
          {lines.map((line, i) => {
            const margin = lineMargin(line)
            const isMaterials = line.category === 'materials'
            const isInstall = isInstallCategory(line.category)
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
                <div className={cn('grid gap-3', canSeeFinancials ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1')}>
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
                      <div className="flex flex-col justify-end pb-0.5">
                        <p className="text-[11px] text-muted-foreground">Margin</p>
                        <p className="text-sm font-medium tnum">{formatValue(margin)}</p>
                      </div>
                    </>
                  )}
                </div>

                {canSeeFinancials && (
                  isInstall ? (
                    <p className="text-[11px] text-muted-foreground">
                      Installation — billed separately, earns the flat install fee (not margin commission).
                    </p>
                  ) : (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        name={`line_${i}_commissionable`}
                        checked={line.commissionable}
                        onChange={(e) => updateLine(i, { commissionable: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-input"
                      />
                      Commissionable (margin counts toward commission)
                    </label>
                  )
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
                Commissionable <strong className="tnum">{formatValue(cMargin)}</strong>
              </span>
            </>
          )}
        </div>
      </section>

      {/* Commission rates & install fee — financials only */}
      {canSeeFinancials && (
        <section className="space-y-4">
          <h2 className="label-caps text-muted-foreground">Commission Rates &amp; Install</h2>
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Sales rate comes from the project-size tier ({SIZE_TIER_LABELS[tier]}): {SALES_RATE_BY_TIER[tier]}%.
            Override only for exceptions (federal addendum, held founding rate). Per-rep +1pt accelerator (after $1M
            collected profit/yr) is applied automatically. Marketing is paid via the referral fee below.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sales_rate_override" className={labelClass}>
                Sales rate override (%)
              </label>
              <input
                id="sales_rate_override"
                name="sales_rate_override"
                type="number"
                step="any"
                min="0"
                value={salesRateOverride}
                onChange={(e) => setSalesRateOverride(e.target.value)}
                placeholder={`tier ${SALES_RATE_BY_TIER[tier]}%`}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="install_fee" className={labelClass}>
                Install fee ($)
              </label>
              <input
                id="install_fee"
                name="install_fee"
                type="number"
                step="any"
                min="0"
                value={installFee}
                onChange={(e) => setInstallFee(e.target.value)}
                placeholder={`${INSTALL_FEE_MIN} – ${INSTALL_FEE_MAX}`}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Flat, to the salesperson.</p>
            </div>
          </div>

          {/* Live commission readback */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border px-3 py-2 text-xs">
            <span>
              Sales comm ({effSalesRate}%) <strong className="tnum">{formatValue(salesComm)}</strong>
            </span>
            {installFeeNum > 0 && (
              <span>
                Install fee <strong className="tnum">{formatValue(installFeeNum)}</strong>
              </span>
            )}
            {referralAmount > 0 && (
              <span>
                Referral <strong className="tnum">{formatValue(referralAmount)}</strong>
              </span>
            )}
            <span>
              Net after comm.{' '}
              <strong className="tnum">
                {formatValue(totalMargin - salesComm - installFeeNum - referralAmount)}
              </strong>
            </span>
          </div>
        </section>
      )}

      {/* Marketing / referral source — the contact who referred the deal + fee */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">Marketing / Referral Source</h2>
        <p className="-mt-2 text-[11px] text-muted-foreground">
          The contact who brought or marketed this deal — typically a Ber Wilson employee, but it can be an outside
          referrer.{canSeeFinancials ? ' They earn the referral fee (a flat amount or a % of the deal margin).' : ''}
        </p>

        {/* Hidden id carries the picked contact through the form submit. */}
        <input type="hidden" name="referral_party_id" value={source?.id ?? ''} readOnly />

        <div>
          <label className={labelClass}>Source (contact)</label>
          <SourcePicker
            contacts={contacts}
            selected={source}
            onSelect={setSource}
            onClear={() => setSource(null)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Search any contact in the directory. Leave blank for a channel with no specific person.
          </p>
        </div>

        {canSeeFinancials && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="referral_fee_type" className={labelClass}>
                Referral fee
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
                  {referralType === 'flat' ? 'Amount ($)' : 'Percent of margin (%)'}
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
        )}
      </section>

      {/* Lead source channel (categorization, distinct from the paid source above) */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">Lead Source</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lead_source" className={labelClass}>
              Channel
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
              How the deal came in (Marketing, Trade Show, Website…). New channels are saved for next time.
            </p>
          </div>
          <div>
            <label htmlFor="lead_source_detail" className={labelClass}>
              Channel Detail
            </label>
            <input
              id="lead_source_detail"
              name="lead_source_detail"
              type="text"
              defaultValue={deal?.lead_source_detail ?? ''}
              placeholder="Which trade show, campaign, etc."
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* Timeline & next step */}
      <section className="space-y-4">
        <h2 className="label-caps text-muted-foreground">Timeline</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="expected_delivery_date" className={labelClass}>
              Expected Delivery
            </label>
            <DatePicker id="expected_delivery_date" name="expected_delivery_date" defaultValue={deal?.expected_delivery_date ?? ''} />
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
            <DatePicker id="next_step_date" name="next_step_date" defaultValue={deal?.next_step_date ?? ''} />
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
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        ) : (
          <Link href={cancelHref} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </Link>
        )}
      </div>
    </form>
  )
}
