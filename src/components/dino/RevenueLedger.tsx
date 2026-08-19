'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { formatDate } from '@/lib/utils/constants'
import { dinoSource, DINO_SOURCE_BADGE, DINO_SOURCE_LABELS } from '@/lib/utils/dino'

export interface DinoRevenueRow {
  id: string
  source_type: string
  project_id: string | null
  project: { id: string; name: string } | null
  client_name: string | null
  description: string | null
  amount: number
  revenue_date: string
  notes: string | null
}

interface ProjectOption {
  id: string
  name: string
}

interface FormValues {
  source_type: string
  project_id: string
  client_name: string
  description: string
  amount: string
  revenue_date: string
  notes: string
}

function emptyForm(): FormValues {
  return {
    source_type: 'internal',
    project_id: '',
    client_name: '',
    description: '',
    amount: '',
    revenue_date: new Date().toISOString().slice(0, 10),
    notes: '',
  }
}

function toForm(row: DinoRevenueRow): FormValues {
  return {
    source_type: row.source_type,
    project_id: row.project_id ?? '',
    client_name: row.client_name ?? '',
    description: row.description ?? '',
    amount: row.amount != null ? String(row.amount) : '',
    revenue_date: row.revenue_date,
    notes: row.notes ?? '',
  }
}

const inputClass = cn(
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
)
const labelClass = 'block text-[11px] font-medium text-foreground mb-1'

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

function DollarHint({ value }: { value: string }) {
  const n = parseFloat(value)
  if (isNaN(n) || n <= 0) return null
  return <p className="mt-1 text-[11px] text-muted-foreground tnum">= {money(n)}</p>
}

export default function RevenueLedger({ entries, projects }: { entries: DinoRevenueRow[]; projects: ProjectOption[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null) // 'new' = adding
  const [values, setValues] = useState<FormValues>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DinoRevenueRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  function set<K extends keyof FormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function startAdd() {
    setValues(emptyForm())
    setEditingId('new')
  }

  function startEdit(row: DinoRevenueRow) {
    setValues(toForm(row))
    setEditingId(row.id)
  }

  async function save() {
    if (!values.amount || parseFloat(values.amount) <= 0) {
      toast.error('Enter the job amount.')
      return
    }
    if (!values.revenue_date) {
      toast.error('Pick the revenue date.')
      return
    }
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(isNew ? '/api/dino/revenue' : `/api/dino/revenue/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Save failed' }))
        toast.error(error ?? 'Save failed')
        return
      }
      toast.success(isNew ? 'Revenue added' : 'Revenue updated')
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
      const res = await fetch(`/api/dino/revenue/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Delete failed' }))
        toast.error(error ?? 'Delete failed')
        return
      }
      toast.success('Revenue removed')
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const isInternal = values.source_type === 'internal'

  const form = editingId !== null && (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-4 space-y-4">
      <h3 className="label-caps text-muted-foreground">{editingId === 'new' ? 'New revenue' : 'Edit revenue'}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Source</label>
          <select value={values.source_type} onChange={(e) => set('source_type', e.target.value)} className={inputClass}>
            <option value="internal">Ber Wilson (internal)</option>
            <option value="external">External client</option>
          </select>
        </div>
        {isInternal ? (
          <div>
            <label className={labelClass}>
              Ber Wilson project <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <select value={values.project_id} onChange={(e) => set('project_id', e.target.value)} className={inputClass}>
              <option value="">— link a project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelClass}>
              Client <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input type="text" value={values.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="e.g. existing clients" className={inputClass} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Amount ($)</label>
          <input type="number" step="any" min="0" value={values.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Job / period revenue" className={inputClass} />
          <DollarHint value={values.amount} />
        </div>
        <div>
          <label className={labelClass}>Date</label>
          <DatePicker value={values.revenue_date} onChange={(v) => set('revenue_date', v)} className="h-8 text-xs" />
        </div>
      </div>

      <div>
        <label className={labelClass}>
          Description <span className="font-normal text-muted-foreground">(job, or e.g. &ldquo;Q1 2026 — existing clients&rdquo;)</span>
        </label>
        <input type="text" value={values.description} onChange={(e) => set('description', e.target.value)} className={inputClass} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60">
          {saving && <Loader2 size={13} className="animate-spin" />}
          {editingId === 'new' ? 'Add revenue' : 'Save changes'}
        </button>
        <button onClick={() => setEditingId(null)} disabled={saving} className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="rounded-xl border border-border bg-card elev-1">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <h2 className="label-caps text-muted-foreground">Revenue ledger</h2>
        {editingId === null && (
          <button onClick={startAdd} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[11px] font-medium hover:bg-accent transition-colors">
            <Plus size={13} />
            Add
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {editingId === 'new' && form}

        {entries.length === 0 && editingId !== 'new' ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No revenue recorded yet. Add internal jobs (linked to a Ber Wilson project) and external work to see the split.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((row) => {
              if (editingId === row.id) return <li key={row.id}>{form}</li>
              const src = dinoSource(row.source_type)
              const who = src === 'internal' ? row.project?.name ?? 'Ber Wilson' : row.client_name ?? 'External client'
              return (
                <li key={row.id} className="flex items-center gap-3 rounded-md bg-muted/30 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', DINO_SOURCE_BADGE[src])}>
                        {DINO_SOURCE_LABELS[src]}
                      </span>
                      {src === 'internal' && row.project ? (
                        <Link href={`/projects/${row.project.id}`} className="text-xs font-medium text-foreground hover:text-primary transition-colors truncate">
                          {who}
                        </Link>
                      ) : (
                        <span className="text-xs font-medium text-foreground truncate">{who}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {formatDate(row.revenue_date)}
                      {row.description ? ` · ${row.description}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tnum">{money(row.amount)}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => startEdit(row)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Edit revenue">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setDeleteTarget(row)} className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors" aria-label="Delete revenue">
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
        title="Remove this revenue entry?"
        description="This deletes the ledger row. This cannot be undone."
        confirmLabel={deleting ? 'Removing…' : 'Remove'}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
