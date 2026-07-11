'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, Building2, Landmark } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
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
} from '@/lib/utils/investors'

export interface InvestmentRow extends Investment {
  project: { id: string; name: string } | null
  spv: { id: string; name: string } | null
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
  entities: Option[]
  raises?: Option[]
}

interface FormValues {
  target_kind: string
  project_id: string
  raise_id: string
  spv_entity_id: string
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
  spv_entity_id: '',
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
    spv_entity_id: inv.spv_entity_id ?? '',
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

const inputClass = cn(
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
)
const labelClass = 'block text-[11px] font-medium text-foreground mb-1'

export default function InvestmentsSection({ investorId, investments, projects, entities, raises = [] }: InvestmentsSectionProps) {
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {editingId === 'new' ? 'New Investment' : 'Edit Investment'}
      </h3>

      {/* Target */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Target</label>
          <select
            value={values.target_kind}
            onChange={(e) => set('target_kind', e.target.value)}
            className={inputClass}
          >
            <option value="company">Ber Wilson (parent)</option>
            <option value="project">Project / SPV</option>
          </select>
        </div>
        {raises.length > 0 && (
          <div>
            <label className={labelClass}>
              Raise <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              value={values.raise_id}
              onChange={(e) => set('raise_id', e.target.value)}
              className={inputClass}
            >
              <option value="">Not part of a raise</option>
              {raises.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {values.target_kind === 'project' && (
          <>
            <div>
              <label className={labelClass}>Project</label>
              <select
                value={values.project_id}
                onChange={(e) => set('project_id', e.target.value)}
                className={inputClass}
              >
                <option value="">Pick a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                SPV Entity <span className="font-normal text-muted-foreground">(once formed)</span>
              </label>
              <select
                value={values.spv_entity_id}
                onChange={(e) => set('spv_entity_id', e.target.value)}
                className={inputClass}
              >
                <option value="">Not formed yet</option>
                {entities.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Stage + instrument */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Stage</label>
          <select value={values.stage} onChange={(e) => set('stage', e.target.value)} className={inputClass}>
            {INVESTMENT_STAGES.map((s) => (
              <option key={s} value={s}>
                {INVESTMENT_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Instrument</label>
          <select value={values.instrument} onChange={(e) => set('instrument', e.target.value)} className={inputClass}>
            <option value="">—</option>
            {INSTRUMENTS.map((i) => (
              <option key={i} value={i}>
                {INSTRUMENT_LABELS[i]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Amounts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Indicated ($)</label>
          <input type="number" step="any" min="0" value={values.amount_indicated} onChange={(e) => set('amount_indicated', e.target.value)} placeholder="Soft interest" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Committed ($)</label>
          <input type="number" step="any" min="0" value={values.amount_committed} onChange={(e) => set('amount_committed', e.target.value)} placeholder="Signed" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Funded ($)</label>
          <input type="number" step="any" min="0" value={values.amount_funded} onChange={(e) => set('amount_funded', e.target.value)} placeholder="Wired" className={inputClass} />
        </div>
      </div>

      {/* Terms */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Equity (%)</label>
          <input type="number" step="any" min="0" max="100" value={values.equity_pct} onChange={(e) => set('equity_pct', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Profit Share (%)</label>
          <input type="number" step="any" min="0" max="100" value={values.profit_share_pct} onChange={(e) => set('profit_share_pct', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Preferred Return (%)</label>
          <input type="number" step="any" min="0" max="100" value={values.preferred_return_pct} onChange={(e) => set('preferred_return_pct', e.target.value)} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>
          Terms Notes <span className="font-normal text-muted-foreground">(waterfall, side letters — the legal docs govern)</span>
        </label>
        <textarea
          value={values.terms_notes}
          onChange={(e) => set('terms_notes', e.target.value)}
          className={cn(inputClass, 'h-auto min-h-[60px] py-2 resize-y')}
        />
      </div>

      {/* Dates + next step */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={labelClass}>First Discussed</label>
          <DatePicker value={values.first_discussed_date} onChange={(v) => set('first_discussed_date', v)} />
        </div>
        <div>
          <label className={labelClass}>Target Close</label>
          <DatePicker value={values.target_close_date} onChange={(v) => set('target_close_date', v)} />
        </div>
        <div>
          <label className={labelClass}>Committed</label>
          <DatePicker value={values.committed_date} onChange={(v) => set('committed_date', v)} />
        </div>
        <div>
          <label className={labelClass}>Funded</label>
          <DatePicker value={values.funded_date} onChange={(v) => set('funded_date', v)} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Next Step</label>
        <input type="text" value={values.next_step} onChange={(e) => set('next_step', e.target.value)} placeholder="The single next action on this deal" className={inputClass} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          {editingId === 'new' ? 'Add Investment' : 'Save Changes'}
        </button>
        <button
          onClick={() => setEditingId(null)}
          disabled={saving}
          className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Add button */}
      {editingId === null && (
        <button
          onClick={startAdd}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus size={13} />
          Add Investment
        </button>
      )}

      {editingId === 'new' && form}

      {/* List */}
      {investments.length === 0 && editingId !== 'new' ? (
        <p className="text-sm text-muted-foreground py-2">
          No investments recorded yet. Add one to track amounts and terms against the parent company or a project.
        </p>
      ) : (
        <ul className="space-y-3">
          {investments.map((inv) => {
            if (editingId === inv.id) {
              return <li key={inv.id}>{form}</li>
            }
            const s = investmentStage(inv.stage)
            const targetLabel =
              inv.target_kind === 'company' ? 'Ber Wilson (parent)' : inv.project?.name ?? 'Project'
            return (
              <li key={inv.id} className="rounded-lg border border-border bg-card p-4 elev-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                        {inv.target_kind === 'company' ? <Landmark size={13} className="text-muted-foreground" /> : <Building2 size={13} className="text-muted-foreground" />}
                        {inv.target_kind === 'project' && inv.project ? (
                          <Link href={`/projects/${inv.project.id}`} className="hover:text-primary transition-colors">
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
                      {inv.spv && (
                        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          SPV: {inv.spv.name}
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

                    {/* Amounts */}
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
                    <button
                      onClick={() => startEdit(inv)}
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Edit investment"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(inv)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                      aria-label="Delete investment"
                    >
                      <Trash2 size={13} />
                    </button>
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
