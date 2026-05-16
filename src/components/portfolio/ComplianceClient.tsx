'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { COMPLIANCE_STATUSES, COMPLIANCE_STATUS_LABELS, formatDate } from '@/lib/utils/constants'
import type { ComplianceItem } from '@/lib/supabase/types'

interface ComplianceClientProps {
  siteId: string
  initialItems: ComplianceItem[]
}

const COMPLIANCE_STATUS_BADGE: Record<string, string> = {
  not_started: 'bg-slate-100 text-slate-600 ring-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  compliant: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  non_compliant: 'bg-red-50 text-red-600 ring-red-200',
  waived: 'bg-amber-50 text-amber-700 ring-amber-200',
}

const EMPTY_FORM = {
  framework: '',
  requirement: '',
  status: '' as ComplianceItem['status'] | '',
  due_date: '',
  notes: '',
}

type FormState = typeof EMPTY_FORM

export default function ComplianceClient({ siteId, initialItems }: ComplianceClientProps) {
  const router = useRouter()
  const [items, setItems] = useState<ComplianceItem[]>(initialItems)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ComplianceItem | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  function field(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setOpen(true)
  }

  function openEdit(ci: ComplianceItem) {
    setEditing(ci)
    setForm({
      framework: ci.framework ?? '',
      requirement: ci.requirement ?? '',
      status: ci.status ?? '',
      due_date: ci.due_date ?? '',
      notes: ci.notes ?? '',
    })
    setError(null)
    setOpen(true)
  }

  async function handleSave() {
    if (!form.framework.trim() || !form.requirement.trim()) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        framework: form.framework.trim(),
        requirement: form.requirement.trim(),
        status: form.status || null,
        due_date: form.due_date || null,
        notes: form.notes.trim() || null,
      }

      if (editing) {
        const res = await fetch(`/api/portfolio/compliance/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { compliance_item } = await res.json()
        setItems(prev => prev.map(ci => ci.id === editing.id ? compliance_item : ci))
      } else {
        const res = await fetch(`/api/portfolio/sites/${siteId}/compliance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { compliance_item } = await res.json()
        setItems(prev => [...prev, compliance_item])
      }

      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/portfolio/compliance/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      setItems(prev => prev.filter(ci => ci.id !== id))
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  // Group by framework
  const byFramework = new Map<string, ComplianceItem[]>()
  for (const ci of items) {
    const fw = ci.framework ?? 'Other'
    const existing = byFramework.get(fw) ?? []
    existing.push(ci)
    byFramework.set(fw, existing)
  }

  // Status summary
  const statusCounts = items.reduce((acc, ci) => {
    const s = ci.status ?? 'not_started'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="mt-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        {items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(statusCounts).map(([status, count]) => (
              <span
                key={status}
                className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${COMPLIANCE_STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}
              >
                {COMPLIANCE_STATUS_LABELS[status as keyof typeof COMPLIANCE_STATUS_LABELS] ?? status}: {count}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors shrink-0 ml-auto"
        >
          <Plus size={13} />
          Add Item
        </button>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400 mb-3">No compliance items tracked for this site yet.</p>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            <Plus size={13} />
            Add Item
          </button>
        </div>
      ) : (
        Array.from(byFramework.entries()).map(([framework, fwItems]) => (
          <section key={framework} className="bg-white rounded-lg border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">{framework}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Requirement</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Due Date</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Notes</th>
                    <th className="px-3 py-2 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {fwItems.map(ci => {
                    const isOverdue = ci.due_date && ci.status !== 'compliant' && ci.status !== 'waived' && new Date(ci.due_date) < new Date()
                    return (
                      <tr key={ci.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">{ci.requirement ?? ci.framework}</td>
                        <td className="px-3 py-2">
                          {ci.status ? (
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${COMPLIANCE_STATUS_BADGE[ci.status as string] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                              {COMPLIANCE_STATUS_LABELS[ci.status as keyof typeof COMPLIANCE_STATUS_LABELS] ?? ci.status}
                            </span>
                          ) : <span className="text-slate-400 text-xs">—</span>}
                        </td>
                        <td className={`px-3 py-2 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                          {ci.due_date ? formatDate(ci.due_date) : '—'}
                          {isOverdue && ' (overdue)'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 max-w-xs truncate">{ci.notes ?? '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(ci)} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-slate-100 transition-colors" title="Edit">
                              <Pencil size={13} className="text-slate-400" />
                            </button>
                            {confirmDeleteId === ci.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-red-600 font-medium">Delete?</span>
                                <button onClick={() => handleDelete(ci.id)} disabled={deletingId === ci.id} className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                                  {deletingId === ci.id ? '…' : 'Yes'}
                                </button>
                                <button onClick={() => setConfirmDeleteId(null)} className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 transition-colors">
                                  <X size={11} />
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteId(ci.id)} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Compliance Item' : 'Add Compliance Item'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Framework <span className="text-red-500">*</span>
              </label>
              <input value={form.framework} onChange={e => field('framework', e.target.value)} placeholder="e.g. NEPA, OSHA, Local Permitting" disabled={saving} className={inputClass} autoFocus />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Requirement <span className="text-red-500">*</span>
              </label>
              <input value={form.requirement} onChange={e => field('requirement', e.target.value)} placeholder="e.g. Environmental Impact Statement" disabled={saving} className={inputClass} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</label>
                <select value={form.status ?? ''} onChange={e => field('status', e.target.value)} disabled={saving} className={inputClass}>
                  <option value="">Select…</option>
                  {COMPLIANCE_STATUSES.map(s => (
                    <option key={s} value={s}>{COMPLIANCE_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => field('due_date', e.target.value)} disabled={saving} className={inputClass} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
              <textarea value={form.notes} onChange={e => field('notes', e.target.value)} rows={2} disabled={saving} className={`${inputClass} resize-none`} />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setOpen(false)} disabled={saving} className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.framework.trim() || !form.requirement.trim() || saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Add Item'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
