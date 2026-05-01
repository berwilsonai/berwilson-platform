'use client'

import { useState } from 'react'
import {
  DollarSign,
  Plus,
  Pencil,
  Check,
  X,
  Loader2,
  Lock,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/shared/EmptyState'
import type { FinancingWithSchedule } from '@/types/domain'
import type { DrawScheduleEntry } from '@/types/domain'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n.toFixed(2)}%`
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [year, month, day] = d.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function parseNum(s: string): number | null {
  const v = parseFloat(s.replace(/[$,]/g, ''))
  return isNaN(v) ? null : v
}

// ---------------------------------------------------------------------------
// Local form types
// ---------------------------------------------------------------------------

type DrawRow = {
  milestone: string
  amount: string
  drawn: boolean
  date: string
}

type FormState = {
  structure_type: string
  senior_debt: string
  mezzanine: string
  equity_amount: string
  equity_pct: string
  ltv: string
  interest_rate: string
  lender: string
  pe_partner: string
  waterfall_notes: string
  notes: string
  drawRows: DrawRow[]
}

function emptyForm(): FormState {
  return {
    structure_type: '',
    senior_debt: '',
    mezzanine: '',
    equity_amount: '',
    equity_pct: '',
    ltv: '',
    interest_rate: '',
    lender: '',
    pe_partner: '',
    waterfall_notes: '',
    notes: '',
    drawRows: [],
  }
}

function financingToForm(f: FinancingWithSchedule): FormState {
  return {
    structure_type: f.structure_type ?? '',
    senior_debt: f.senior_debt != null ? String(f.senior_debt) : '',
    mezzanine: f.mezzanine != null ? String(f.mezzanine) : '',
    equity_amount: f.equity_amount != null ? String(f.equity_amount) : '',
    equity_pct: f.equity_pct != null ? String(f.equity_pct) : '',
    ltv: f.ltv != null ? String(f.ltv) : '',
    interest_rate: f.interest_rate != null ? String(f.interest_rate) : '',
    lender: f.lender ?? '',
    pe_partner: f.pe_partner ?? '',
    waterfall_notes: f.waterfall_notes ?? '',
    notes: f.notes ?? '',
    drawRows: (f.draw_schedule ?? []).map((e) => ({
      milestone: e.milestone,
      amount: String(e.amount),
      drawn: e.drawn > 0,
      date: e.date ?? '',
    })),
  }
}

function formToPayload(form: FormState) {
  const drawSchedule: DrawScheduleEntry[] = form.drawRows
    .filter((r) => r.milestone.trim() || r.amount)
    .map((r) => ({
      milestone: r.milestone.trim(),
      amount: parseNum(r.amount) ?? 0,
      drawn: r.drawn ? 1 : 0,
      date: r.date || undefined,
    }))

  return {
    structure_type: form.structure_type.trim() || null,
    senior_debt: parseNum(form.senior_debt),
    mezzanine: parseNum(form.mezzanine),
    equity_amount: parseNum(form.equity_amount),
    equity_pct: parseNum(form.equity_pct),
    ltv: parseNum(form.ltv),
    interest_rate: parseNum(form.interest_rate),
    lender: form.lender.trim() || null,
    pe_partner: form.pe_partner.trim() || null,
    waterfall_notes: form.waterfall_notes.trim() || null,
    notes: form.notes.trim() || null,
    draw_schedule: drawSchedule.length > 0 ? drawSchedule : null,
  }
}

// ---------------------------------------------------------------------------
// Capital Stack Bar
// ---------------------------------------------------------------------------

function CapitalStackBar({
  seniorDebt,
  mezzanine,
  equityAmount,
}: {
  seniorDebt: number | null
  mezzanine: number | null
  equityAmount: number | null
}) {
  const debt = seniorDebt ?? 0
  const mezz = mezzanine ?? 0
  const equity = equityAmount ?? 0
  const total = debt + mezz + equity

  if (total === 0) return null

  const debtPct = (debt / total) * 100
  const mezzPct = (mezz / total) * 100
  const equityPct = (equity / total) * 100

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Capital Stack
        </p>
        <p className="text-xs text-muted-foreground">
          Total: <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
        </p>
      </div>

      {/* Stacked bar */}
      <div className="flex h-9 rounded-md overflow-hidden ring-1 ring-border">
        {debt > 0 && (
          <div
            className="bg-blue-600 flex items-center justify-center text-white text-[11px] font-semibold transition-all"
            style={{ width: `${debtPct}%` }}
          >
            {debtPct >= 12 && `${debtPct.toFixed(0)}%`}
          </div>
        )}
        {mezz > 0 && (
          <div
            className="bg-amber-500 flex items-center justify-center text-white text-[11px] font-semibold border-l-2 border-white/30 transition-all"
            style={{ width: `${mezzPct}%` }}
          >
            {mezzPct >= 12 && `${mezzPct.toFixed(0)}%`}
          </div>
        )}
        {equity > 0 && (
          <div
            className="bg-emerald-600 flex items-center justify-center text-white text-[11px] font-semibold border-l-2 border-white/30 transition-all"
            style={{ width: `${equityPct}%` }}
          >
            {equityPct >= 12 && `${equityPct.toFixed(0)}%`}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {debt > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-sm bg-blue-600 shrink-0" />
            <span className="text-muted-foreground">Senior Debt</span>
            <span className="font-semibold">{formatCurrency(seniorDebt)}</span>
            <span className="text-muted-foreground">({debtPct.toFixed(0)}%)</span>
          </div>
        )}
        {mezz > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" />
            <span className="text-muted-foreground">Mezzanine</span>
            <span className="font-semibold">{formatCurrency(mezzanine)}</span>
            <span className="text-muted-foreground">({mezzPct.toFixed(0)}%)</span>
          </div>
        )}
        {equity > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-sm bg-emerald-600 shrink-0" />
            <span className="text-muted-foreground">Equity</span>
            <span className="font-semibold">{formatCurrency(equityAmount)}</span>
            <span className="text-muted-foreground">({equityPct.toFixed(0)}%)</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field display helpers
// ---------------------------------------------------------------------------

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-3 border-t border-border pt-5">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Form field helpers
// ---------------------------------------------------------------------------

function FormField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const prefixInputCls =
  'w-full rounded-md border border-input bg-background pl-7 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const suffixInputCls =
  'w-full rounded-md border border-input bg-background pl-3 pr-7 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

function CurrencyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <FormField label={label}>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
          $
        </span>
        <input
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '0'}
          className={prefixInputCls}
        />
      </div>
    </FormField>
  )
}

function PctField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <FormField label={label}>
      <div className="relative">
        <input
          type="number"
          min="0"
          max="100"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '0.00'}
          className={suffixInputCls}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
          %
        </span>
      </div>
    </FormField>
  )
}

// ---------------------------------------------------------------------------
// Draw schedule editor
// ---------------------------------------------------------------------------

function DrawScheduleEditor({
  rows,
  onChange,
}: {
  rows: DrawRow[]
  onChange: (rows: DrawRow[]) => void
}) {
  function update(idx: number, patch: Partial<DrawRow>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function addRow() {
    onChange([...rows, { milestone: '', amount: '', drawn: false, date: '' }])
  }

  function removeRow(idx: number) {
    onChange(rows.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_120px_80px_120px_32px] gap-0 bg-muted border-b border-border">
            {(['Milestone', 'Amount', 'Drawn', 'Target Date', ''] as const).map(
              (h, i) => (
                <div
                  key={i}
                  className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-r last:border-r-0 border-border"
                >
                  {h}
                </div>
              )
            )}
          </div>

          {/* Rows */}
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_120px_80px_120px_32px] gap-0 border-b last:border-b-0 border-border"
            >
              <div className="border-r border-border">
                <input
                  value={row.milestone}
                  onChange={(e) => update(idx, { milestone: e.target.value })}
                  placeholder="e.g. Foundation pour"
                  className="w-full px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
                />
              </div>
              <div className="relative border-r border-border">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs select-none">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={row.amount}
                  onChange={(e) => update(idx, { amount: e.target.value })}
                  placeholder="0"
                  className="w-full pl-5 pr-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
                />
              </div>
              <div className="flex items-center justify-center border-r border-border">
                <input
                  type="checkbox"
                  checked={row.drawn}
                  onChange={(e) => update(idx, { drawn: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-input accent-emerald-600"
                />
              </div>
              <div className="border-r border-border">
                <input
                  type="date"
                  value={row.date}
                  onChange={(e) => update(idx, { date: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs bg-background text-muted-foreground focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
                />
              </div>
              <div className="flex items-center justify-center">
                <button
                  onClick={() => removeRow(idx)}
                  className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
                  title="Remove row"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={addRow}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={12} />
        Add draw
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface FinancingTabProps {
  projectId: string
  initialFinancing: FinancingWithSchedule | null
}

export default function FinancingTab({
  projectId,
  initialFinancing,
}: FinancingTabProps) {
  const [financing, setFinancing] = useState(initialFinancing)
  const [mode, setMode] = useState<'view' | 'form'>('view')
  const [form, setForm] = useState<FormState>(
    initialFinancing ? financingToForm(initialFinancing) : emptyForm()
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function openCreate() {
    setForm(emptyForm())
    setError(null)
    setMode('form')
  }

  function openEdit() {
    if (!financing) return
    setForm(financingToForm(financing))
    setError(null)
    setMode('form')
  }

  function cancelForm() {
    setMode('view')
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const payload = formToPayload(form)

    try {
      let res: Response
      if (financing) {
        res = await fetch(`/api/financing/${financing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/financing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, ...payload }),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }

      const { financing: saved } = await res.json()
      const typed: FinancingWithSchedule = {
        ...saved,
        draw_schedule: Array.isArray(saved.draw_schedule)
          ? (saved.draw_schedule as unknown as typeof financing extends null ? never : FinancingWithSchedule['draw_schedule'])
          : null,
      }
      setFinancing(typed)
      setMode('view')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!financing && mode === 'view') {
    return (
      <EmptyState
        icon={DollarSign}
        title="No financing structure"
        description="Add the capital stack, lender details, and draw schedule for this project."
        action={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            <Plus size={14} />
            Add Financing Structure
          </button>
        }
      />
    )
  }

  // ── Form (create or edit) ────────────────────────────────────────────────
  if (mode === 'form') {
    return (
      <div className="max-w-2xl space-y-6">
        {/* Classification banner */}
        <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
          <Lock size={13} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800 font-medium">
            CONFIDENTIAL — Financial data. Handle per information security policy.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {financing ? 'Edit Financing Structure' : 'Add Financing Structure'}
          </h2>
        </div>

        {/* Structure details */}
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Structure Details
          </p>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Structure Type">
              <input
                type="text"
                value={form.structure_type}
                onChange={(e) => setField('structure_type', e.target.value)}
                placeholder="e.g. Construction Loan, CMBS, Bridge"
                className={cn(inputCls, 'col-span-2')}
              />
            </FormField>
            <FormField label="Lender">
              <input
                type="text"
                value={form.lender}
                onChange={(e) => setField('lender', e.target.value)}
                placeholder="Lender name"
                className={inputCls}
              />
            </FormField>
            <FormField label="PE / Equity Partner">
              <input
                type="text"
                value={form.pe_partner}
                onChange={(e) => setField('pe_partner', e.target.value)}
                placeholder="Partner name"
                className={inputCls}
              />
            </FormField>
            <PctField
              label="Interest Rate"
              value={form.interest_rate}
              onChange={(v) => setField('interest_rate', v)}
              placeholder="e.g. 6.75"
            />
            <PctField
              label="LTV"
              value={form.ltv}
              onChange={(v) => setField('ltv', v)}
              placeholder="e.g. 65.00"
            />
          </div>
        </div>

        {/* Capital stack */}
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-t border-border pt-5">
            Capital Stack
          </p>
          <div className="grid grid-cols-2 gap-4">
            <CurrencyField
              label="Senior Debt"
              value={form.senior_debt}
              onChange={(v) => setField('senior_debt', v)}
            />
            <CurrencyField
              label="Mezzanine"
              value={form.mezzanine}
              onChange={(v) => setField('mezzanine', v)}
            />
            <CurrencyField
              label="Equity Amount"
              value={form.equity_amount}
              onChange={(v) => setField('equity_amount', v)}
            />
            <PctField
              label="Equity %"
              value={form.equity_pct}
              onChange={(v) => setField('equity_pct', v)}
            />
          </div>

          {/* Live preview of the bar while editing */}
          {(parseNum(form.senior_debt) || parseNum(form.mezzanine) || parseNum(form.equity_amount)) && (
            <div className="rounded-md bg-muted/40 border border-border p-4">
              <CapitalStackBar
                seniorDebt={parseNum(form.senior_debt)}
                mezzanine={parseNum(form.mezzanine)}
                equityAmount={parseNum(form.equity_amount)}
              />
            </div>
          )}
        </div>

        {/* Draw schedule */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-t border-border pt-5">
            Draw Schedule
          </p>
          <DrawScheduleEditor
            rows={form.drawRows}
            onChange={(rows) => setField('drawRows', rows)}
          />
        </div>

        {/* Notes */}
        <div className="space-y-4 border-t border-border pt-5">
          <FormField label="Waterfall Notes">
            <textarea
              value={form.waterfall_notes}
              onChange={(e) => setField('waterfall_notes', e.target.value)}
              rows={3}
              placeholder="Distribution waterfall, promote structure, preferred return terms..."
              className={cn(inputCls, 'resize-y')}
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              rows={3}
              placeholder="General notes, conditions, covenants..."
              className={cn(inputCls, 'resize-y')}
            />
          </FormField>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border pt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {financing ? 'Save Changes' : 'Create Structure'}
          </button>
          <button
            onClick={cancelForm}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <X size={14} />
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── View mode ────────────────────────────────────────────────────────────
  if (!financing) return null

  const drawSchedule = financing.draw_schedule ?? []
  const totalDrawn = drawSchedule
    .filter((e) => e.drawn > 0)
    .reduce((sum, e) => sum + e.amount, 0)
  const totalScheduled = drawSchedule.reduce((sum, e) => sum + e.amount, 0)

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Financing Structure</h2>
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300">
            <Lock size={9} />
            Confidential
          </span>
        </div>
        <button
          onClick={openEdit}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors shrink-0"
        >
          <Pencil size={12} />
          Edit
        </button>
      </div>

      {/* Capital stack visualization */}
      <div className="rounded-lg border border-border bg-card p-4">
        <CapitalStackBar
          seniorDebt={financing.senior_debt}
          mezzanine={financing.mezzanine}
          equityAmount={financing.equity_amount}
        />
        {financing.senior_debt == null &&
          financing.mezzanine == null &&
          financing.equity_amount == null && (
            <p className="text-xs text-muted-foreground italic">
              No capital stack amounts entered.
            </p>
          )}
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
        {financing.structure_type && (
          <FieldRow label="Structure Type" value={financing.structure_type} />
        )}
        {financing.lender && (
          <FieldRow label="Lender" value={financing.lender} />
        )}
        {financing.pe_partner && (
          <FieldRow label="PE / Equity Partner" value={financing.pe_partner} />
        )}
        <FieldRow
          label="Senior Debt"
          value={
            <span className="font-medium text-blue-700">
              {formatCurrency(financing.senior_debt)}
            </span>
          }
        />
        <FieldRow
          label="Mezzanine"
          value={
            <span className="font-medium text-amber-700">
              {formatCurrency(financing.mezzanine)}
            </span>
          }
        />
        <FieldRow
          label="Equity"
          value={
            <span className="font-medium text-emerald-700">
              {financing.equity_amount != null
                ? `${formatCurrency(financing.equity_amount)}${financing.equity_pct != null ? ` (${formatPct(financing.equity_pct)})` : ''}`
                : '—'}
            </span>
          }
        />
        <FieldRow label="LTV" value={formatPct(financing.ltv)} />
        <FieldRow label="Interest Rate" value={formatPct(financing.interest_rate)} />
      </div>

      {/* Draw schedule */}
      {drawSchedule.length > 0 && (
        <>
          <SectionHeader>Draw Schedule</SectionHeader>

          {/* Progress summary */}
          {totalScheduled > 0 && (
            <div className="flex items-center gap-3 text-xs mb-3">
              <span className="text-muted-foreground">
                Drawn:{' '}
                <span className="font-semibold text-emerald-700">
                  {formatCurrency(totalDrawn)}
                </span>
              </span>
              <span className="text-muted-foreground">
                Remaining:{' '}
                <span className="font-semibold text-foreground">
                  {formatCurrency(totalScheduled - totalDrawn)}
                </span>
              </span>
              <span className="text-muted-foreground">
                Total:{' '}
                <span className="font-semibold text-foreground">
                  {formatCurrency(totalScheduled)}
                </span>
              </span>
            </div>
          )}

          <div className="rounded-lg border border-border overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_100px_72px_110px] bg-muted border-b border-border">
              {(['Milestone', 'Amount', 'Status', 'Date'] as const).map((h, i) => (
                <div
                  key={i}
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-r last:border-r-0 border-border"
                >
                  {h}
                </div>
              ))}
            </div>

            {/* Table rows */}
            {drawSchedule.map((entry, idx) => (
              <div
                key={idx}
                className={cn(
                  'grid grid-cols-[1fr_100px_72px_110px] border-b last:border-b-0 border-border',
                  entry.drawn > 0 && 'bg-emerald-50/40'
                )}
              >
                <div className="px-3 py-2.5 text-sm text-foreground border-r border-border">
                  {entry.milestone || '—'}
                </div>
                <div className="px-3 py-2.5 text-sm font-medium text-foreground border-r border-border tabular-nums">
                  {formatCurrency(entry.amount)}
                </div>
                <div className="px-3 py-2.5 border-r border-border">
                  {entry.drawn > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <Check size={11} />
                      Drawn
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Pending</span>
                  )}
                </div>
                <div className="px-3 py-2.5 text-sm text-muted-foreground">
                  {formatDate(entry.date ?? null)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Waterfall notes */}
      {financing.waterfall_notes && (
        <>
          <SectionHeader>Waterfall / Distribution</SectionHeader>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {financing.waterfall_notes}
          </p>
        </>
      )}

      {/* General notes */}
      {financing.notes && (
        <>
          <SectionHeader>Notes</SectionHeader>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {financing.notes}
          </p>
        </>
      )}
    </div>
  )
}
