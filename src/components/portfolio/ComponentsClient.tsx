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
import {
  COMPONENT_TYPES,
  COMPONENT_TYPE_LABELS,
  COMPONENT_TYPE_BADGE,
  COMPONENT_STATUSES,
  COMPONENT_STATUS_LABELS,
  COMPONENT_STATUS_BADGE,
  formatValue,
} from '@/lib/utils/constants'
import type { Component } from '@/lib/supabase/types'

interface ComponentsClientProps {
  siteId: string
  initialComponents: Component[]
}

const EMPTY_FORM = {
  type: '' as Component['type'] | '',
  name: '',
  phase: '',
  status: '' as Component['status'] | '',
  capital_low: '',
  capital_mid: '',
  capital_high: '',
  notes: '',
}

type FormState = typeof EMPTY_FORM

export default function ComponentsClient({ siteId, initialComponents }: ComponentsClientProps) {
  const router = useRouter()
  const [components, setComponents] = useState<Component[]>(initialComponents)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Component | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setOpen(true)
  }

  function openEdit(c: Component) {
    setEditing(c)
    setForm({
      type: c.type,
      name: c.name,
      phase: c.phase ?? '',
      status: c.status ?? '',
      capital_low: c.capital_low != null ? String(c.capital_low) : '',
      capital_mid: c.capital_mid != null ? String(c.capital_mid) : '',
      capital_high: c.capital_high != null ? String(c.capital_high) : '',
      notes: c.notes ?? '',
    })
    setError(null)
    setOpen(true)
  }

  function field(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!form.type || !form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        type: form.type,
        name: form.name.trim(),
        phase: form.phase.trim() || null,
        status: form.status || null,
        capital_low: form.capital_low ? Number(form.capital_low) : null,
        capital_mid: form.capital_mid ? Number(form.capital_mid) : null,
        capital_high: form.capital_high ? Number(form.capital_high) : null,
        notes: form.notes.trim() || null,
      }

      if (editing) {
        const res = await fetch(`/api/portfolio/components/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { component } = await res.json()
        setComponents(prev => prev.map(c => c.id === editing.id ? component : c))
      } else {
        const res = await fetch(`/api/portfolio/sites/${siteId}/components`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { component } = await res.json()
        setComponents(prev => [...prev, component])
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
      const res = await fetch(`/api/portfolio/components/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      setComponents(prev => prev.filter(c => c.id !== id))
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const totalMid = components.reduce((sum, c) => sum + Number(c.capital_mid ?? 0), 0)
  const totalLow = components.reduce((sum, c) => sum + Number(c.capital_low ?? 0), 0)
  const totalHigh = components.reduce((sum, c) => sum + Number(c.capital_high ?? 0), 0)

  return (
    <div className="mt-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-slate-500 dark:text-muted-foreground">
            {components.length} component{components.length !== 1 ? 's' : ''}
          </span>
          {totalMid > 0 && (
            <>
              <span className="text-slate-300 dark:text-muted-foreground">|</span>
              <span className="text-slate-500 dark:text-muted-foreground">
                Capital range:{' '}
                <span className="font-mono font-medium text-slate-900 dark:text-foreground">
                  {formatValue(totalLow > 0 ? totalLow : totalMid * 0.8)} – {formatValue(totalHigh > 0 ? totalHigh : totalMid * 1.3)}
                </span>
              </span>
            </>
          )}
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 dark:bg-white/15 text-white text-xs font-medium hover:bg-slate-700 dark:hover:bg-white/10 transition-colors"
        >
          <Plus size={13} />
          Add Component
        </button>
      </div>

      {/* Table */}
      {components.length === 0 ? (
        <div className="bg-white dark:bg-card rounded-lg border border-slate-200 dark:border-border p-8 text-center">
          <p className="text-sm text-slate-400 dark:text-muted-foreground mb-3">No components have been added to this site yet.</p>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 dark:bg-white/15 text-white text-xs font-medium hover:bg-slate-700 dark:hover:bg-white/10 transition-colors"
          >
            <Plus size={13} />
            Add Component
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-card rounded-lg border border-slate-200 dark:border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-border/60 bg-slate-50 dark:bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">Phase</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">Low</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">Mid</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 dark:text-muted-foreground">High</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {components.map(c => (
                <tr key={c.id} className="border-b border-slate-50 dark:border-border/40 hover:bg-slate-50 dark:hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${COMPONENT_TYPE_BADGE[c.type as keyof typeof COMPONENT_TYPE_BADGE]}`}>
                      {COMPONENT_TYPE_LABELS[c.type as keyof typeof COMPONENT_TYPE_LABELS]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-foreground">{c.name}</td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-muted-foreground text-xs">{c.phase ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {c.status ? (
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${COMPONENT_STATUS_BADGE[c.status as keyof typeof COMPONENT_STATUS_BADGE]}`}>
                        {COMPONENT_STATUS_LABELS[c.status as keyof typeof COMPONENT_STATUS_LABELS]}
                      </span>
                    ) : <span className="text-slate-400 dark:text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500 dark:text-muted-foreground">{c.capital_low ? formatValue(Number(c.capital_low)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-200 font-medium">{c.capital_mid ? formatValue(Number(c.capital_mid)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500 dark:text-muted-foreground">{c.capital_high ? formatValue(Number(c.capital_high)) : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(c)}
                        className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-slate-100 dark:hover:bg-muted transition-colors"
                        title="Edit"
                      >
                        <Pencil size={13} className="text-slate-400 dark:text-muted-foreground" />
                      </button>
                      {confirmDeleteId === c.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600 font-medium">Delete?</span>
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={deletingId === c.id}
                            className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {deletingId === c.id ? '…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 dark:hover:bg-muted transition-colors"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(c.id)}
                          className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} className="text-slate-400 dark:text-muted-foreground hover:text-red-500" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {totalMid > 0 && (
              <tfoot>
                <tr className="bg-slate-50 dark:bg-muted/50 font-medium">
                  <td colSpan={4} className="px-4 py-2.5 text-slate-700 dark:text-slate-200 text-xs uppercase tracking-wider">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-200">{totalLow > 0 ? formatValue(totalLow) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-900 dark:text-foreground font-bold">{formatValue(totalMid)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 dark:text-slate-200">{totalHigh > 0 ? formatValue(totalHigh) : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Component' : 'Add Component'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.type}
                  onChange={e => field('type', e.target.value)}
                  disabled={saving}
                  className={inputClass}
                >
                  <option value="">Select type…</option>
                  {COMPONENT_TYPES.map(t => (
                    <option key={t} value={t}>{COMPONENT_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={e => field('status', e.target.value)}
                  disabled={saving}
                  className={inputClass}
                >
                  <option value="">Select status…</option>
                  {COMPONENT_STATUSES.map(s => (
                    <option key={s} value={s}>{COMPONENT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={e => field('name', e.target.value)}
                placeholder="e.g. 25MW Solar Array"
                disabled={saving}
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Phase
              </label>
              <input
                value={form.phase}
                onChange={e => field('phase', e.target.value)}
                placeholder="e.g. Phase 1A"
                disabled={saving}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {(['capital_low', 'capital_mid', 'capital_high'] as const).map((k, i) => (
                <div key={k} className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Capital {['Low', 'Mid', 'High'][i]}
                  </label>
                  <input
                    type="number"
                    value={form[k]}
                    onChange={e => field(k, e.target.value)}
                    placeholder="0"
                    disabled={saving}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={e => field('notes', e.target.value)}
                rows={2}
                disabled={saving}
                className={`${inputClass} resize-none`}
              />
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              disabled={saving}
              className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.type || !form.name.trim() || saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 dark:bg-white/15 text-white text-sm font-medium hover:bg-slate-700 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Add Component'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
