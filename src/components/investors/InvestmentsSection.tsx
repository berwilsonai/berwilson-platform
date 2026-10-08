'use client'

/**
 * An investor's commitments — THE RAISE PIPELINE, and not the cap table.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE POINT OF THIS SCREEN. `investments` carried
 * equity/committed/funded and so did `project_spv_participants`, with nothing
 * naming which was the record: two homes for one quantity, which is how a
 * reader ends up trusting neither (CLAUDE.md §12). They are now named apart —
 * this is the relationship over time, the ledger on the vehicle is who holds
 * what — and the two are never summed. "Add to cap table" is the only crossing,
 * it needs a click, and it fills blanks rather than overwriting.
 *
 * A commitment also targets a VEHICLE now, not an entity. `spv_entity_id`
 * pointed at the legal company, so the same LLC reused across two deals made
 * the pointer ambiguous by construction (migration 20261008000001).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, Building2, Landmark, Boxes, TableProperties } from 'lucide-react'
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

/** The raise stages at which a commitment may be put on a cap table. */
const LEDGER_STAGES = new Set(['committed', 'docs', 'funded'])

export interface InvestmentRow extends Investment {
  project: { id: string; name: string } | null
  /** Resolved server-side: `project_spvs` is outside the generated types (§4). */
  vehicle: { id: string; label: string; dealName: string; dealHref: string } | null
  raise?: { id: string; name: string } | null
}

interface Option {
  id: string
  name: string
}

/** A vehicle a commitment can point at, named with the deal it belongs to. */
export interface VehicleChoice {
  id: string
  label: string
  dealName: string
}

interface InvestmentsSectionProps {
  investorId: string
  investments: InvestmentRow[]
  projects: Option[]
  /** Every vehicle on every deal this viewer may see. */
  vehicles: VehicleChoice[]
  raises?: Option[]
}

interface FormValues {
  target_kind: string
  project_id: string
  raise_id: string
  spv_id: string
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
  spv_id: '',
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
    spv_id: inv.spv_id ?? '',
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

export default function InvestmentsSection({ investorId, investments, projects, vehicles, raises = [] }: InvestmentsSectionProps) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null) // 'new' = adding
  const [values, setValues] = useState<FormValues>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<InvestmentRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)

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
    if (values.target_kind === 'spv' && !values.spv_id) {
      toast.error('Pick the vehicle this commitment goes into.')
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

  /**
   * Put a committed investor on the vehicle's cap table.
   *
   * ⚠ A CLICK, NEVER AUTOMATIC. The pipeline holds soft indications; the cap
   * table holds what was papered. The route fills blanks and never overwrites,
   * and it deliberately does NOT set an equity split — a dollar commitment is
   * not a percentage, and that table is where our own share is read from. The
   * message it returns says so, so it is shown rather than replaced with a
   * generic "Saved".
   */
  async function addToCapTable(inv: InvestmentRow) {
    if (!inv.vehicle) return
    setPromoting(inv.id)
    try {
      const res = await fetch(`/api/spvs/${inv.vehicle.id}/participants/from-investment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investment_id: inv.id }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
        created?: boolean
      }
      if (!res.ok) {
        toast.error(payload.error ?? 'Could not reach the cap table')
        return
      }
      // `created: false` is not a failure — the investor was already there and
      // nothing was changed. Said in the words the route chose.
      if (payload.created) toast.success(payload.message ?? 'Added to the cap table')
      else toast.info(payload.message ?? 'Already on the cap table')
      router.refresh()
    } catch {
      toast.error('Could not reach the cap table')
    } finally {
      setPromoting(null)
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
            // A native select sizes to its widest option, so a long vehicle
            // name would stretch the column and wrap the rest (§12).
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
            hint="the deal as a whole, not a specific vehicle in it"
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
        {values.target_kind === 'spv' && (
          /*
            ⚠ THE VEHICLE IS THE TARGET, AND THE DEAL IS REACHED THROUGH IT.
            There is deliberately no second "which project" field: a vehicle
            already knows its deal, and a second copy of that is a second
            definition that can drift. It is also the only way a commitment can
            attach to an OPPORTUNITY at all — `investments` has no
            `opportunity_id`.
          */
          <Field
            id={`vehicle-${editingId}`}
            label="Vehicle"
            hint={
              vehicles.length === 0
                ? 'no vehicles exist yet — add one on a deal’s Vehicles tab'
                : 'the SPV the money goes into'
            }
            className="sm:col-span-2"
          >
            <Select
              id={`vehicle-${editingId}`}
              className="max-w-full"
              value={values.spv_id}
              onChange={(e) => set('spv_id', e.target.value)}
              disabled={vehicles.length === 0}
            >
              <option value="">Pick a vehicle…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.dealName}
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

      {/* Amounts — THE PIPELINE'S VIEW. The cap table is on the vehicle. */}
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
        {values.target_kind === 'spv' && (
          <p className="text-xs text-muted-foreground">
            These are the raise pipeline’s figures for this relationship. Who actually holds what in
            the vehicle is its cap table, on the deal’s Vehicles tab — the two are kept apart on
            purpose and are never added together.
          </p>
        )}
      </div>

      {/* Terms */}
      <FormGrid cols={3}>
        <Field
          id={`equity-${editingId}`}
          label="Equity (%)"
          hint={values.target_kind === 'spv' ? 'what was negotiated; the cap table is the record' : undefined}
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
          company, a project, or a specific vehicle on a deal.
        </p>
      ) : (
        <ul className="space-y-3">
          {investments.map((inv) => {
            if (editingId === inv.id) {
              return <li key={inv.id}>{form}</li>
            }
            const s = investmentStage(inv.stage)
            // ⚠ ONE SHARED LABEL, because four screens had written their own
            // and all four rendered an SPV commitment as the bare word
            // "Project" — `project_id` is NULL on an spv-targeted row by
            // design, so the fallback was the branch that always fired.
            const targetLabel = investmentTargetLabel(inv)
            const targetHref =
              inv.target_kind === 'spv'
                ? inv.vehicle
                  ? `${inv.vehicle.dealHref}/vehicles`
                  : null
                : inv.target_kind === 'project' && inv.project
                  ? `/projects/${inv.project.id}`
                  : null
            const TargetIcon =
              inv.target_kind === 'company' ? Landmark : inv.target_kind === 'spv' ? Boxes : Building2
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

                    {/*
                      ⚠ THE ONE CROSSING BETWEEN THE TWO LEDGERS, AND IT IS A
                      BUTTON. Offered only once the raise says the money is real
                      — a soft indication is a conversation, not a holding — and
                      the route fills blanks rather than overwriting, so pressing
                      it twice cannot rewrite what a lawyer papered.

                      Gated on `sm:` nowhere: a control that only appears on
                      hover does not exist on a phone (§12), so it is always
                      visible.
                    */}
                    {inv.target_kind === 'spv' && inv.vehicle && LEDGER_STAGES.has(inv.stage) && (
                      <div className="pt-1">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={promoting === inv.id}
                          onClick={() => void addToCapTable(inv)}
                        >
                          {promoting === inv.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <TableProperties size={12} />
                          )}
                          Add to cap table
                        </Button>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Puts {inv.vehicle.label}’s ledger row in place with this commitment’s
                          dollars. The equity split stays undetermined — a dollar figure is not a
                          percentage.
                        </p>
                      </div>
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
