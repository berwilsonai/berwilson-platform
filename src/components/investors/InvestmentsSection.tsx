'use client'

/**
 * An investor's commitments — THE RAISE PIPELINE, and not the cap table.
 *
 * ⚠ THERE IS NO CAP TABLE ANY MORE. `project_spv_participants` was the ledger
 * this screen was carefully kept apart from, and it went with the Vehicles
 * module on 2026-10-23 — taking the `spv` target, the vehicle picker and the
 * "Add to cap table" crossing with it. What is left is unambiguous: this is the
 * relationship over time, and a commitment names the parent company or a
 * project. If a ledger of who-holds-what returns, it is a separate table and
 * this screen still must not sum against it (CLAUDE.md §12).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, Building2, Landmark } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import type { Investment } from '@/lib/supabase/types'
import { formatValue, formatDate } from '@/lib/utils/constants'
import {
  investmentStage,
  instrumentLabel,
  INVESTMENT_STAGES,
  INVESTMENT_STAGE_LABELS,
  INVESTMENT_STAGE_BADGE,
  INSTRUMENTS,
  INSTRUMENT_LABELS,
  INVESTMENT_TARGET_KINDS,
  INVESTMENT_TARGET_LABELS,
  investmentTargetLabel,
} from '@/lib/utils/investors'

export interface InvestmentRow extends Investment {
  project: { id: string; name: string } | null
  raise?: { id: string; name: string } | null
}

interface Option {
  id: string
  name: string
}

interface InvestmentsSectionProps {
  investorId: string
  investments: InvestmentRow[]
  projects: Option[]
  raises?: Option[]
}

interface FormValues {
  target_kind: string
  project_id: string
  raise_id: string
  stage: string
  instrument: string
  amount_indicated: string
  amount_committed: string
  amount_funded: string
  equity_pct: string
  profit_share_pct: string
  preferred_return_pct: string
  terms_notes: string
  first_discussed_date: string
  target_close_date: string
  committed_date: string
  funded_date: string
  next_step: string
}

const EMPTY: FormValues = {
  target_kind: 'company',
  project_id: '',
  raise_id: '',
  stage: 'discussing',
  instrument: '',
  amount_indicated: '',
  amount_committed: '',
  amount_funded: '',
  equity_pct: '',
  profit_share_pct: '',
  preferred_return_pct: '',
  terms_notes: '',
  first_discussed_date: '',
  target_close_date: '',
  committed_date: '',
  funded_date: '',
  next_step: '',
}

function toFormValues(inv: InvestmentRow): FormValues {
  return {
    target_kind: inv.target_kind,
    project_id: inv.project_id ?? '',
    raise_id: inv.raise_id ?? '',
    stage: inv.stage,
    instrument: inv.instrument ?? '',
    amount_indicated: inv.amount_indicated != null ? String(inv.amount_indicated) : '',
    amount_committed: inv.amount_committed != null ? String(inv.amount_committed) : '',
    amount_funded: inv.amount_funded != null ? String(inv.amount_funded) : '',
    equity_pct: inv.equity_pct != null ? String(inv.equity_pct) : '',
    profit_share_pct: inv.profit_share_pct != null ? String(inv.profit_share_pct) : '',
    preferred_return_pct: inv.preferred_return_pct != null ? String(inv.preferred_return_pct) : '',
    terms_notes: inv.terms_notes ?? '',
    first_discussed_date: inv.first_discussed_date ?? '',
    target_close_date: inv.target_close_date ?? '',
    committed_date: inv.committed_date ?? '',
    funded_date: inv.funded_date ?? '',
    next_step: inv.next_step ?? '',
  }
}

/** Live readback of a raw dollar input — catches missing/extra zeros. */
function DollarHint({ value }: { value: string }) {
  const n = parseFloat(value)
  if (isNaN(n) || n <= 0) return null
  return <p className="mt-1 text-[11px] text-muted-foreground tnum">= {formatValue(n)}</p>
}

export default function InvestmentsSection({ investorId, investments, projects, raises = [] }: InvestmentsSectionProps) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null) // 'new' = adding
  const [values, setValues] = useState<FormValues>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<InvestmentRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  function set<K extends keyof FormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function startAdd() {
    setValues(EMPTY)
    setEditingId('new')
  }

  function startEdit(inv: InvestmentRow) {
    setValues(toFormValues(inv))
    setEditingId(inv.id)
  }

  async function save() {
    if (values.target_kind === 'project' && !values.project_id) {
      toast.error('Pick the project this investment targets.')
      return
    }
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(isNew ? '/api/investments' : `/api/investments/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { investor_id: investorId, ...values } : values),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Save failed' }))
        toast.error(error ?? 'Save failed')
        return
      }
      toast.success(isNew ? 'Investment added' : 'Investment updated')
      setEditingId(null)
      router.refresh()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/investments/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Delete failed' }))
        toast.error(error ?? 'Delete failed')
        return
      }
      toast.success('Investment removed')
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const form = editingId !== null && (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-4 space-y-4">
      <h3 className="label-caps text-muted-foreground">
        {editingId === 'new' ? 'New Investment' : 'Edit Investment'}
      </h3>

      {/* Target */}
      <FormGrid cols={3}>
        <Field id={`target-${editingId}`} label="Target">
          <Select
            id={`target-${editingId}`}
            // A native select sizes to its widest option, so a long name
            // would stretch the column and wrap the rest (§12).
            className="max-w-full"
            value={values.target_kind}
            onChange={(e) => set('target_kind', e.target.value)}
          >
            {/* Generated from the shared member list, so the form can never
                offer a target the database refuses or miss one it accepts. */}
            {INVESTMENT_TARGET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {INVESTMENT_TARGET_LABELS[kind]}
              </option>
            ))}
          </Select>
        </Field>
        {raises.length > 0 && (
          <Field id={`raise-${editingId}`} label="Raise" hint="optional">
            <Select
              id={`raise-${editingId}`}
              className="max-w-full"
              value={values.raise_id}
              onChange={(e) => set('raise_id', e.target.value)}
            >
              <option value="">Not part of a raise</option>
              {raises.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {values.target_kind === 'project' && (
          <Field
            id={`project-${editingId}`}
            label="Project"
            hint="the deal this commitment is into"
          >
            <Select
              id={`project-${editingId}`}
              className="max-w-full"
              value={values.project_id}
              onChange={(e) => set('project_id', e.target.value)}
            >
              <option value="">Pick a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </FormGrid>

      {/* Stage + instrument */}
      <FormGrid cols={2}>
        <Field id={`stage-${editingId}`} label="Stage">
          <Select
            id={`stage-${editingId}`}
            className="max-w-full"
            value={values.stage}
            onChange={(e) => set('stage', e.target.value)}
          >
            {INVESTMENT_STAGES.map((s) => (
              <option key={s} value={s}>
                {INVESTMENT_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`instrument-${editingId}`} label="Instrument">
          <Select
            id={`instrument-${editingId}`}
            className="max-w-full"
            value={values.instrument}
            onChange={(e) => set('instrument', e.target.value)}
          >
            <option value="">Not decided</option>
            {INSTRUMENTS.map((i) => (
              <option key={i} value={i}>
                {INSTRUMENT_LABELS[i]}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>

      {/* Amounts — THE PIPELINE'S VIEW: indicated, committed, funded. */}
      <div className="space-y-2">
        <FormGrid cols={3}>
          <Field id={`indicated-${editingId}`} label="Indicated ($)">
            <Input
              id={`indicated-${editingId}`}
              inputMode="decimal"
              value={values.amount_indicated}
              onChange={(e) => set('amount_indicated', e.target.value)}
              placeholder="Soft interest"
            />
            <DollarHint value={values.amount_indicated} />
          </Field>
          <Field id={`committed-${editingId}`} label="Committed ($)">
            <Input
              id={`committed-${editingId}`}
              inputMode="decimal"
              value={values.amount_committed}
              onChange={(e) => set('amount_committed', e.target.value)}
              placeholder="Signed"
            />
            <DollarHint value={values.amount_committed} />
          </Field>
          <Field id={`funded-${editingId}`} label="Funded ($)">
            <Input
              id={`funded-${editingId}`}
              inputMode="decimal"
              value={values.amount_funded}
              onChange={(e) => set('amount_funded', e.target.value)}
              placeholder="Wired"
            />
            <DollarHint value={values.amount_funded} />
          </Field>
        </FormGrid>
      </div>

      {/* Terms */}
      <FormGrid cols={3}>
        <Field
          id={`equity-${editingId}`}
          label="Equity (%)"
          hint="what was negotiated"
        >
          <Input
            id={`equity-${editingId}`}
            inputMode="decimal"
            value={values.equity_pct}
            onChange={(e) => set('equity_pct', e.target.value)}
          />
        </Field>
        <Field id={`profit-${editingId}`} label="Profit share (%)">
          <Input
            id={`profit-${editingId}`}
            inputMode="decimal"
            value={values.profit_share_pct}
            onChange={(e) => set('profit_share_pct', e.target.value)}
          />
        </Field>
        <Field id={`pref-${editingId}`} label="Preferred return (%)">
          <Input
            id={`pref-${editingId}`}
            inputMode="decimal"
            value={values.preferred_return_pct}
            onChange={(e) => set('preferred_return_pct', e.target.value)}
          />
        </Field>
      </FormGrid>

      <Field
        id={`terms-${editingId}`}
        label="Terms notes"
        hint="waterfall, side letters — the legal docs govern"
      >
        <Textarea
          id={`terms-${editingId}`}
          rows={3}
          value={values.terms_notes}
          onChange={(e) => set('terms_notes', e.target.value)}
        />
      </Field>

      {/* Dates + next step — DatePicker, never a native date input (§12). */}
      <FormGrid cols={4}>
        <Field label="First discussed">
          <DatePicker value={values.first_discussed_date} onChange={(v) => set('first_discussed_date', v)} />
        </Field>
        <Field label="Target close">
          <DatePicker value={values.target_close_date} onChange={(v) => set('target_close_date', v)} />
        </Field>
        <Field label="Committed">
          <DatePicker value={values.committed_date} onChange={(v) => set('committed_date', v)} />
        </Field>
        <Field label="Funded">
          <DatePicker value={values.funded_date} onChange={(v) => set('funded_date', v)} />
        </Field>
      </FormGrid>

      <Field id={`next-${editingId}`} label="Next step">
        <Input
          id={`next-${editingId}`}
          value={values.next_step}
          onChange={(e) => set('next_step', e.target.value)}
          placeholder="The single next action on this deal"
        />
      </Field>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 size={13} className="animate-spin" />}
          {editingId === 'new' ? 'Add investment' : 'Save changes'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Add button */}
      {editingId === null && (
        <Button size="sm" variant="outline" onClick={startAdd}>
          <Plus size={13} />
          Add investment
        </Button>
      )}

      {editingId === 'new' && form}

      {/* List */}
      {investments.length === 0 && editingId !== 'new' ? (
        <p className="text-sm text-muted-foreground py-2">
          No investments recorded yet. Add one to track amounts and terms against the parent
          company or a project.
        </p>
      ) : (
        <ul className="space-y-3">
          {investments.map((inv) => {
            if (editingId === inv.id) {
              return <li key={inv.id}>{form}</li>
            }
            const s = investmentStage(inv.stage)
            // ⚠ ONE SHARED LABEL, because four screens had written their own
            // and a label that is wrong in four places is a label with no
            // owner (§12).
            const targetLabel = investmentTargetLabel(inv)
            const targetHref =
              inv.target_kind === 'project' && inv.project ? `/projects/${inv.project.id}` : null
            const TargetIcon = inv.target_kind === 'company' ? Landmark : Building2
            return (
              <li key={inv.id} className="rounded-lg border border-border bg-card p-4 elev-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                        <TargetIcon size={13} className="text-muted-foreground" />
                        {targetHref ? (
                          <Link href={targetHref} className="hover:text-primary transition-colors">
                            {targetLabel}
                          </Link>
                        ) : (
                          targetLabel
                        )}
                      </span>
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', INVESTMENT_STAGE_BADGE[s])}>
                        {INVESTMENT_STAGE_LABELS[s]}
                      </span>
                      {inv.instrument && (
                        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {instrumentLabel(inv.instrument)}
                        </span>
                      )}
                      {inv.raise && (
                        <Link
                          href={`/investors/raises/${inv.raise.id}`}
                          className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                        >
                          {inv.raise.name}
                        </Link>
                      )}
                    </div>

                    {/* Amounts — the PIPELINE's figures, labelled as such. */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>Indicated <span className="font-semibold tnum text-foreground">{formatValue(inv.amount_indicated)}</span></span>
                      <span>Committed <span className="font-semibold tnum text-foreground">{formatValue(inv.amount_committed)}</span></span>
                      <span>Funded <span className="font-semibold tnum text-foreground">{formatValue(inv.amount_funded)}</span></span>
                    </div>

                    {/* Terms */}
                    {(inv.equity_pct != null || inv.profit_share_pct != null || inv.preferred_return_pct != null) && (
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                        {inv.equity_pct != null && <span>Equity {inv.equity_pct}%</span>}
                        {inv.profit_share_pct != null && <span>Profit share {inv.profit_share_pct}%</span>}
                        {inv.preferred_return_pct != null && <span>Pref return {inv.preferred_return_pct}%</span>}
                      </div>
                    )}
                    {inv.terms_notes && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{inv.terms_notes}</p>
                    )}
                    {(inv.next_step || inv.target_close_date) && (
                      <p className="text-[11px] text-muted-foreground/80">
                        {inv.next_step ? `Next: ${inv.next_step}` : `Target close ${formatDate(inv.target_close_date)}`}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => startEdit(inv)}
                      aria-label={`Edit the ${targetLabel} commitment`}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setDeleteTarget(inv)}
                      aria-label={`Remove the ${targetLabel} commitment`}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this investment?"
        description="This removes the commitment record. The investor stays. This cannot be undone."
        confirmLabel={deleting ? 'Removing…' : 'Remove'}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
