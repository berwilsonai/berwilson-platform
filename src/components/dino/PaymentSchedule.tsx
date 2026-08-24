'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, Check, CircleDollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { formatDate } from '@/lib/utils/constants'
import { totalOwed, totalPaid, paymentsTotal, daysUntil, isPaymentOverdue } from '@/lib/utils/dino'

export interface DinoPaymentRow {
  id: string
  label: string | null
  amount: number
  due_date: string | null
  paid: boolean
  paid_date: string | null
  notes: string | null
}

interface FormValues {
  label: string
  amount: string
  due_date: string
}

const inputClass = cn(
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
)
const labelClass = 'block text-[11px] font-medium text-foreground mb-1'

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export default function PaymentSchedule({ payments }: { payments: DinoPaymentRow[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null) // 'new' = adding
  const [values, setValues] = useState<FormValues>({ label: '', amount: '', due_date: '' })
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DinoPaymentRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const owed = totalOwed(payments)
  const paid = totalPaid(payments)
  const total = paymentsTotal(payments)

  function set<K extends keyof FormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function startAdd() {
    setValues({ label: '', amount: '', due_date: '' })
    setEditingId('new')
  }

  function startEdit(row: DinoPaymentRow) {
    setValues({ label: row.label ?? '', amount: row.amount != null ? String(row.amount) : '', due_date: row.due_date ?? '' })
    setEditingId(row.id)
  }

  async function save() {
    if (!values.amount || parseFloat(values.amount) <= 0) {
      toast.error('Enter the installment amount.')
      return
    }
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(isNew ? '/api/dino/payments' : `/api/dino/payments/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Save failed' }))
        toast.error(error ?? 'Save failed')
        return
      }
      toast.success(isNew ? 'Installment added' : 'Installment updated')
      setEditingId(null)
      router.refresh()
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function togglePaid(row: DinoPaymentRow) {
    setTogglingId(row.id)
    try {
      const res = await fetch(`/api/dino/payments/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: !row.paid }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Update failed' }))
        toast.error(error ?? 'Update failed')
        return
      }
      router.refresh()
    } catch {
      toast.error('Update failed')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/dino/payments/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Delete failed' }))
        toast.error(error ?? 'Delete failed')
        return
      }
      toast.success('Installment removed')
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const form = editingId !== null && (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-3 space-y-3">
      <div>
        <label className={labelClass}>Label</label>
        <input type="text" value={values.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Installment 1" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Amount ($)</label>
          <input type="number" step="any" min="0" value={values.amount} onChange={(e) => set('amount', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Due</label>
          <DatePicker value={values.due_date} onChange={(v) => set('due_date', v)} className="h-8 text-xs" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">
          {saving && <Loader2 size={13} className="animate-spin" />}
          {editingId === 'new' ? 'Add' : 'Save'}
        </button>
        <button onClick={() => setEditingId(null)} disabled={saving} className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="rounded-xl border border-border bg-card elev-1">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <CircleDollarSign size={13} className="text-muted-foreground" />
        <h2 className="label-caps text-muted-foreground">Owed to Dino</h2>
        {editingId === null && (
          <button onClick={startAdd} className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[11px] font-medium hover:bg-accent transition-colors">
            <Plus size={13} />
            Add
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Totals */}
        {payments.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-muted/30 py-2">
              <p className="text-sm font-semibold tnum text-amber-600 dark:text-amber-400">{money(owed)}</p>
              <p className="text-[10px] text-muted-foreground">Outstanding</p>
            </div>
            <div className="rounded-md bg-muted/30 py-2">
              <p className="text-sm font-semibold tnum text-emerald-600 dark:text-emerald-400">{money(paid)}</p>
              <p className="text-[10px] text-muted-foreground">Paid</p>
            </div>
            <div className="rounded-md bg-muted/30 py-2">
              <p className="text-sm font-semibold tnum">{money(total)}</p>
              <p className="text-[10px] text-muted-foreground">Total</p>
            </div>
          </div>
        )}

        {editingId === 'new' && form}

        {payments.length === 0 && editingId !== 'new' ? (
          <p className="text-sm text-muted-foreground py-3 text-center">
            No installments yet. Add the payments you owe Dino so they surface as they come due.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {payments.map((row) => {
              if (editingId === row.id) return <li key={row.id}>{form}</li>
              const overdue = isPaymentOverdue(row)
              const days = daysUntil(row.due_date)
              return (
                <li key={row.id} className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
                  <button
                    onClick={() => togglePaid(row)}
                    disabled={togglingId === row.id}
                    aria-label={row.paid ? 'Mark unpaid' : 'Mark paid'}
                    className={cn(
                      'shrink-0 size-5 rounded-full border flex items-center justify-center transition-colors',
                      row.paid
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-input text-transparent hover:border-emerald-400'
                    )}
                  >
                    {togglingId === row.id ? <Loader2 size={11} className="animate-spin text-muted-foreground" /> : <Check size={12} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-xs font-medium truncate', row.paid && 'text-muted-foreground line-through')}>
                      {row.label ?? 'Installment'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {row.paid
                        ? `Paid ${formatDate(row.paid_date)}`
                        : row.due_date
                          ? (
                            <span className={cn(overdue && 'text-amber-600 dark:text-amber-400 font-medium')}>
                              Due {formatDate(row.due_date)}
                              {days !== null && (overdue ? ` · ${Math.abs(days)}d overdue` : days <= 30 ? ` · in ${days}d` : '')}
                            </span>
                          )
                          : 'No due date'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tnum">{money(row.amount)}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => startEdit(row)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Edit installment">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setDeleteTarget(row)} className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors" aria-label="Delete installment">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this installment?"
        description="This deletes the scheduled payment. This cannot be undone."
        confirmLabel={deleting ? 'Removing…' : 'Remove'}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
