'use client'

/**
 * The quick calc: punch in numbers on a call and read the answer.
 *
 * ⚠ IT COMPUTES IN THE BROWSER, WITH THE SAME ENGINE THE DEAL TAB USES.
 * src/lib/economics is pure and imports only its own siblings, so the identical
 * code runs here with no round trip. The answer appears as you type and cannot
 * disagree with the deal tab, because there is only one formula.
 *
 * ⚠ AND THE STATE LIVES IN THE URL. A figure quoted to a prospect is a link
 * that reproduces it exactly, and `history.replaceState` keeps it off the
 * server so typing does not refetch anything.
 *
 * Simplicity is a functional requirement here. Two fields produce an answer;
 * everything else is behind one toggle.
 */

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Field, Input, Select } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { formatPercent, formatValue } from '@/lib/utils/constants'
import {
  computeScratch,
  SCRATCH_UNITS,
  scratchToParams,
  type ScratchInput,
  type ScratchUnit,
} from '@/lib/economics/scratch'
import SaveScratchToDeal from './SaveScratchToDeal'

interface QuickCalcProps {
  initial: ScratchInput
  /** Hidden in the dock, where there is no room and no URL to own. */
  showSave?: boolean
  /** The dock does not own the address bar. */
  syncUrl?: boolean
}

type Draft = Record<keyof ScratchInput, string>

function toDraft(input: ScratchInput): Draft {
  const s = (v: number | null) => (v == null ? '' : String(v))
  return {
    mw: s(input.mw),
    price: s(input.price),
    unit: input.unit,
    loadFactor: s(input.loadFactor),
    pue: s(input.pue),
    termYears: s(input.termYears),
    escalatorPct: s(input.escalatorPct),
    discountRatePct: s(input.discountRatePct),
    capturePct: s(input.capturePct),
  }
}

/** An empty field is "nobody has said", never 0. */
function parse(draft: Draft): ScratchInput {
  const n = (raw: string): number | null => {
    const cleaned = raw.replace(/[$,\s%]/g, '')
    if (cleaned === '') return null
    const value = Number(cleaned)
    return Number.isFinite(value) ? value : null
  }
  return {
    unit: draft.unit as ScratchUnit,
    mw: n(draft.mw),
    price: n(draft.price),
    loadFactor: n(draft.loadFactor),
    pue: n(draft.pue),
    termYears: n(draft.termYears),
    escalatorPct: n(draft.escalatorPct),
    discountRatePct: n(draft.discountRatePct),
    capturePct: n(draft.capturePct),
  }
}

function Line({
  label,
  value,
  hint,
  strong,
}: {
  label: string
  value: number | null
  hint?: string
  strong?: boolean
}) {
  // A row with no figure is omitted. "$0" beside a real number reads as a fact
  // about the deal rather than as an unfinished calculation.
  if (value == null) return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm">
        {label}
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={strong ? 'tnum text-lg font-semibold' : 'tnum text-sm font-medium'}>
        {formatValue(value)}
      </span>
    </div>
  )
}

export default function QuickCalc({ initial, showSave = true, syncUrl = true }: QuickCalcProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [open, setOpen] = useState(
    initial.loadFactor != null ||
      initial.pue != null ||
      initial.termYears != null ||
      initial.capturePct != null
  )

  const input = useMemo(() => parse(draft), [draft])
  const { result, formula, ready } = useMemo(() => computeScratch(input), [input])

  const set = useCallback(
    (field: keyof ScratchInput, value: string) => {
      setDraft((d) => {
        const next = { ...d, [field]: value }
        if (syncUrl && typeof window !== 'undefined') {
          // replaceState, not a router push: typing must not add a history
          // entry per keystroke and must not reach the server at all.
          const params = scratchToParams(parse(next))
          window.history.replaceState(null, '', `?${params.toString()}`)
        }
        return next
      })
    },
    [syncUrl]
  )

  const unitShape = SCRATCH_UNITS.find((u) => u.value === input.unit)
  const net = result.tiers.berWilsonNet
  const gross = result.tiers.grossGenerated

  async function copyLink() {
    try {
      const url = `${window.location.origin}/calc?${scratchToParams(input).toString()}`
      await navigator.clipboard.writeText(url)
      toast.success('Link copied. It reproduces these exact figures.')
    } catch {
      toast.error('Could not copy the link')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="qc-mw" label="Megawatts">
          <Input
            id="qc-mw"
            inputMode="decimal"
            autoComplete="off"
            placeholder="20"
            value={draft.mw}
            onChange={(e) => set('mw', e.target.value)}
          />
        </Field>
        <Field id="qc-price" label="Price">
          <Input
            id="qc-price"
            inputMode="decimal"
            autoComplete="off"
            placeholder={input.unit === 'per_kwh' ? '0.08' : input.unit === 'per_mw' ? '17,500,000' : '145'}
            value={draft.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </Field>
        <Field id="qc-unit" label="Per" hint={unitShape?.shape}>
          <Select id="qc-unit" value={draft.unit} onChange={(e) => set('unit', e.target.value)}>
            {SCRATCH_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
        aria-expanded={open}
      >
        <ChevronDown className={open ? 'size-4 rotate-180' : 'size-4'} />
        {open ? 'Fewer inputs' : 'Load factor, PUE, term, escalator, our share'}
      </button>

      {open ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id="qc-lf"
            label="Load factor"
            hint={input.unit === 'per_kwh' ? '0 to 1' : 'energy pricing only'}
          >
            <Input
              id="qc-lf"
              inputMode="decimal"
              placeholder="0.90"
              value={draft.loadFactor}
              onChange={(e) => set('loadFactor', e.target.value)}
            />
          </Field>
          <Field
            id="qc-pue"
            label="PUE"
            hint={input.unit === 'per_kw_month' ? 'set it and the MW is IT load' : 'lease pricing only'}
          >
            <Input
              id="qc-pue"
              inputMode="decimal"
              placeholder="1.30"
              value={draft.pue}
              onChange={(e) => set('pue', e.target.value)}
            />
          </Field>
          <Field id="qc-term" label="Term, years">
            <Input
              id="qc-term"
              inputMode="numeric"
              placeholder="15"
              value={draft.termYears}
              onChange={(e) => set('termYears', e.target.value)}
            />
          </Field>
          <Field id="qc-esc" label="Escalator, % a year">
            <Input
              id="qc-esc"
              inputMode="decimal"
              placeholder="3"
              value={draft.escalatorPct}
              onChange={(e) => set('escalatorPct', e.target.value)}
            />
          </Field>
          <Field id="qc-disc" label="Discount rate, %" hint="for an NPV">
            <Input
              id="qc-disc"
              inputMode="decimal"
              placeholder="9"
              value={draft.discountRatePct}
              onChange={(e) => set('discountRatePct', e.target.value)}
            />
          </Field>
          <Field
            id="qc-cap"
            label="Our share, %"
            hint="makes the line gross and this fee ours"
          >
            <Input
              id="qc-cap"
              inputMode="decimal"
              placeholder="12"
              value={draft.capturePct}
              onChange={(e) => set('capturePct', e.target.value)}
            />
          </Field>
        </div>
      ) : null}

      <div className="rounded-lg bg-muted/40 p-4">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Enter megawatts and a price. Nothing is assumed, so nothing shows until both are in.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-muted-foreground">{formula}</p>
            <div className="divide-y divide-border/60">
              <Line
                label="Annual recurring"
                value={gross.annualRecurringRevenue}
                hint="at stabilization, before escalation"
                strong
              />
              <Line
                label="Contract value"
                value={gross.contractValue}
                hint="over the term, escalation included"
                strong={gross.annualRecurringRevenue == null}
              />
              <Line label="One-time" value={gross.oneTimeRevenue} strong={gross.annualRecurringRevenue == null} />
              <Line label="Total project value" value={gross.totalProjectValue} />
              <Line label="NPV" value={gross.npv} hint="at the discount rate entered" />
              {input.capturePct != null ? (
                <>
                  <Line
                    label="Ber Wilson capture"
                    value={
                      net.oneTimeRevenue ??
                      net.contractValue ??
                      net.annualRecurringRevenue
                    }
                    hint={`${formatPercent(input.capturePct)} of the line above`}
                    strong
                  />
                </>
              ) : null}
            </div>
            {result.lines[0]?.facilityMw ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Draws{' '}
                {result.lines[0].facilityMw.toLocaleString('en-US', { maximumFractionDigits: 1 })}{' '}
                MW
                {result.lines[0].annualEnergyMwh != null
                  ? ` · ${Math.round(result.lines[0].annualEnergyMwh).toLocaleString('en-US')} MWh a year`
                  : ''}
              </p>
            ) : null}
            {result.missing.length > 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Add to see more:{' '}
                {Array.from(new Set(result.missing.map((m) => m.what.toLowerCase()))).join('; ')}
              </p>
            ) : null}
            {result.warnings.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {result.warnings
                  .filter((w) => w.code !== 'no_allocation_ledger' && w.code !== 'no_firm_capacity')
                  .map((w, i) => (
                    <li key={i} className="text-[11px] text-amber-700 dark:text-amber-300">
                      {w.message}
                    </li>
                  ))}
              </ul>
            ) : null}
            <p className="mt-3 text-[11px] text-muted-foreground">
              A planning figure. Every number here was typed, not sourced.
            </p>
          </>
        )}
      </div>

      {ready ? (
        <div className="flex flex-wrap gap-2">
          {syncUrl ? (
            <Button size="sm" variant="outline" onClick={copyLink}>
              <Link2 className="size-4" />
              Copy a link to these figures
            </Button>
          ) : null}
          {showSave ? <SaveScratchToDeal input={input} /> : null}
        </div>
      ) : null}
    </div>
  )
}
