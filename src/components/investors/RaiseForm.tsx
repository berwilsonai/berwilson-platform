'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/date-picker'
import type { Raise } from '@/lib/supabase/types'
import { formatValue } from '@/lib/utils/constants'
import { parseTranches, MAX_TRANCHES } from '@/lib/investors/raises'
import { RAISE_STATUSES, RAISE_STATUS_LABELS } from '@/lib/utils/investors'

interface Option {
  id: string
  name: string
}

interface RaiseFormProps {
  projects: Option[]
  initial?: Raise
}

interface TrancheRow {
  label: string
  amount: string
  target_date: string
}

const inputClass = cn(
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
)
const labelClass = 'block text-xs font-medium text-foreground mb-1'

/** Live readback of a raw dollar input — catches missing/extra zeros. */
function DollarHint({ value }: { value: string }) {
  const n = parseFloat(value)
  if (isNaN(n) || n <= 0) return null
  return <p className="mt-1 text-[11px] text-muted-foreground tnum">= {formatValue(n)}</p>
}

export default function RaiseForm({ projects, initial }: RaiseFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState(initial?.name ?? '')
  const [targetKind, setTargetKind] = useState(initial?.target_kind ?? 'company')
  const [projectId, setProjectId] = useState(initial?.project_id ?? '')
  const [targetAmount, setTargetAmount] = useState(
    initial?.target_amount != null ? String(initial.target_amount) : ''
  )
  const [status, setStatus] = useState(initial?.status ?? 'open')
  const [openDate, setOpenDate] = useState(initial?.open_date ?? '')
  const [targetCloseDate, setTargetCloseDate] = useState(initial?.target_close_date ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [tranches, setTranches] = useState<TrancheRow[]>(
    parseTranches(initial?.tranches).map((t) => ({
      label: t.label,
      amount: String(t.amount),
      target_date: t.target_date ?? '',
    }))
  )

  function setTranche(idx: number, key: keyof TrancheRow, value: string) {
    setTranches((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)))
  }

  function addTranche() {
    setTranches((rows) => [...rows, { label: `Tranche ${rows.length + 1}`, amount: '', target_date: '' }])
  }

  function removeTranche(idx: number) {
    setTranches((rows) => rows.filter((_, i) => i !== idx))
  }

  const trancheSum = tranches.reduce((acc, t) => {
    const v = parseFloat(t.amount)
    return acc + (isNaN(v) ? 0 : v)
  }, 0)
  const targetNum = parseFloat(targetAmount)
  const sumDelta = !isNaN(targetNum) && trancheSum > 0 ? trancheSum - targetNum : null

  async function save() {
    if (!name.trim()) {
      toast.error('Raise name is required.')
      return
    }
    if (targetKind === 'project' && !projectId) {
      toast.error('Pick the project this raise funds.')
      return
    }
    for (const t of tranches) {
      const v = parseFloat(t.amount)
      if (isNaN(v) || v <= 0) {
        toast.error('Every tranche needs a positive amount.')
        return
      }
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        target_kind: targetKind,
        project_id: projectId || null,
        target_amount: targetAmount || null,
        status,
        open_date: openDate || null,
        target_close_date: targetCloseDate || null,
        notes: notes || null,
        tranches: tranches.map((t) => ({
          label: t.label.trim(),
          amount: parseFloat(t.amount),
          target_date: t.target_date || null,
        })),
      }
      const res = await fetch(initial ? `/api/raises/${initial.id}` : '/api/raises', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Save failed')
        return
      }
      toast.success(initial ? 'Raise updated' : 'Raise created')
      router.push(`/investors/raises/${json.raise?.id ?? initial?.id}`)
      router.refresh()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Identity */}
      <div className="rounded-xl border border-border bg-card p-4 elev-1 space-y-4">
        <div>
          <label className={labelClass}>Raise Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={'e.g. "Raise 1 — Ber Wilson ($88M)"'}
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Target</label>
            <select value={targetKind} onChange={(e) => setTargetKind(e.target.value)} className={inputClass}>
              <option value="company">Ber Wilson (parent)</option>
              <option value="project">Project / SPV</option>
            </select>
          </div>
          {targetKind === 'project' && (
            <div>
              <label className={labelClass}>Project</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
                <option value="">Pick a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Target ($)</label>
            <input
              type="number"
              step="any"
              min="0"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              placeholder="88000000"
              className={inputClass}
            />
            <DollarHint value={targetAmount} />
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
              {RAISE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RAISE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Opened</label>
            <DatePicker value={openDate} onChange={setOpenDate} />
          </div>
          <div>
            <label className={labelClass}>Target Close</label>
            <DatePicker value={targetCloseDate} onChange={setTargetCloseDate} />
          </div>
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Use of proceeds, structure, key terms…"
            className={cn(inputClass, 'h-auto min-h-[70px] py-2 resize-y')}
          />
        </div>
      </div>

      {/* Tranches */}
      <div className="rounded-xl border border-border bg-card p-4 elev-1 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="label-caps text-muted-foreground">
            Tranches <span className="font-normal normal-case">(targets — commitments fill them in order)</span>
          </h3>
          {trancheSum > 0 && (
            <span className="text-xs text-muted-foreground tnum">
              {formatValue(trancheSum)} scheduled
              {sumDelta != null && sumDelta !== 0 && (
                <span className={sumDelta > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                  {' '}({sumDelta > 0 ? '+' : '−'}{formatValue(Math.abs(sumDelta))} vs target)
                </span>
              )}
            </span>
          )}
        </div>

        {tranches.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tranches yet — add the schedule (e.g. $25M / $25M / $25M / $13M) to track fill per tranche.
          </p>
        )}

        {tranches.map((t, idx) => (
          <div key={idx} className="flex items-end gap-2">
            <div className="flex-1">
              {idx === 0 && <label className={labelClass}>Label</label>}
              <input
                type="text"
                value={t.label}
                onChange={(e) => setTranche(idx, 'label', e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="w-36">
              {idx === 0 && <label className={labelClass}>Amount ($)</label>}
              <input
                type="number"
                step="any"
                min="0"
                value={t.amount}
                onChange={(e) => setTranche(idx, 'amount', e.target.value)}
                placeholder="25000000"
                className={inputClass}
              />
            </div>
            <div className="w-40">
              {idx === 0 && <label className={labelClass}>Target Date</label>}
              <DatePicker
                value={t.target_date}
                onChange={(v) => setTranche(idx, 'target_date', v)}
                placeholder="Target date"
              />
            </div>
            <button
              onClick={() => removeTranche(idx)}
              className="h-9 px-2 rounded-md text-muted-foreground hover:text-destructive transition-colors"
              aria-label={`Remove ${t.label}`}
            >
              <X size={15} />
            </button>
          </div>
        ))}

        {tranches.length < MAX_TRANCHES && (
          <button
            onClick={addTranche}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Plus size={13} />
            Add Tranche
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {initial ? 'Save Changes' : 'Create Raise'}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving}
          className="h-9 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
