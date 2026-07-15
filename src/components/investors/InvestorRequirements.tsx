'use client'

import { useState } from 'react'
import { Plus, Pencil, Check, X, Loader2, FileText, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InvestorRequirement } from '@/lib/supabase/types'
import {
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_STATUS_LABELS,
  type RequirementCategory,
  type RequirementStatus,
} from '@/lib/utils/investors'

// Documentation requirements checklist — what this investor/lender needs from
// us before they'll underwrite. project_id null = a standing requirement (every
// deal); set = the checklist instance for a specific deal package. Clones the
// ComplianceSection idiom from projects/DiligenceTab.

const STATUS_SELECT_CLS: Record<RequirementStatus, string> = {
  needed: 'bg-slate-100 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800/60',
  in_progress: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60',
  have: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
  submitted: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60',
  waived: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
  n_a: 'bg-slate-100 dark:bg-slate-900/40 text-slate-500 dark:text-slate-500 border-slate-200 dark:border-slate-800/60',
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

type RequirementFormState = {
  category: RequirementCategory
  item: string
  status: RequirementStatus
  project_id: string
  evidence_doc_id: string
  notes: string
}

function emptyForm(): RequirementFormState {
  return {
    category: 'project',
    item: '',
    status: 'needed',
    project_id: '',
    evidence_doc_id: '',
    notes: '',
  }
}

function requirementToForm(r: InvestorRequirement): RequirementFormState {
  return {
    category: (r.category as RequirementCategory) ?? 'other',
    item: r.item,
    status: (r.status as RequirementStatus) ?? 'needed',
    project_id: r.project_id ?? '',
    evidence_doc_id: r.evidence_doc_id ?? '',
    notes: r.notes ?? '',
  }
}

export interface InvestorRequirementsProps {
  investorId: string
  initialItems: InvestorRequirement[]
  projects: { id: string; name: string }[]
  documents: { id: string; file_name: string }[]
}

export default function InvestorRequirements({
  investorId,
  initialItems,
  projects,
  documents,
}: InvestorRequirementsProps) {
  const [items, setItems] = useState(initialItems)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<RequirementFormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]))
  const docsById = Object.fromEntries(documents.map((d) => [d.id, d]))

  // Only projects that actually have items show in the filter
  const projectIdsInUse = [...new Set(items.map((i) => i.project_id).filter(Boolean))] as string[]

  const filtered = items.filter((i) => {
    if (categoryFilter !== 'all' && i.category !== categoryFilter) return false
    if (projectFilter === 'standard' && i.project_id != null) return false
    if (projectFilter !== 'all' && projectFilter !== 'standard' && i.project_id !== projectFilter)
      return false
    return true
  })

  function setField<K extends keyof RequirementFormState>(key: K, value: RequirementFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function openAdd() {
    setForm(emptyForm())
    setEditId(null)
    setError(null)
    setMode('add')
  }

  function openEdit(item: InvestorRequirement) {
    setForm(requirementToForm(item))
    setEditId(item.id)
    setError(null)
    setMode('edit')
  }

  function cancelForm() {
    setMode('list')
    setError(null)
  }

  async function handleSave() {
    if (!form.item.trim()) {
      setError('Item is required')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      category: form.category,
      item: form.item.trim(),
      status: form.status,
      project_id: form.project_id || null,
      evidence_doc_id: form.evidence_doc_id || null,
      notes: form.notes.trim() || null,
    }

    try {
      let res: Response
      if (mode === 'edit' && editId) {
        res = await fetch(`/api/investor-requirements/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/investor-requirements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ investor_id: investorId, ...payload }),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }

      const { requirement } = await res.json()
      if (mode === 'edit') {
        setItems((prev) => prev.map((i) => (i.id === requirement.id ? requirement : i)))
      } else {
        setItems((prev) => [...prev, requirement])
      }
      setMode('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/investor-requirements/${editId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Delete failed')
      }
      setItems((prev) => prev.filter((i) => i.id !== editId))
      setMode('list')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(item: InvestorRequirement, newStatus: RequirementStatus) {
    const prev = item
    setStatusUpdatingId(item.id)
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i)))

    try {
      const res = await fetch(`/api/investor-requirements/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        setItems((all) => all.map((i) => (i.id === prev.id ? prev : i)))
        return
      }
      const { requirement } = await res.json()
      setItems((all) => all.map((i) => (i.id === requirement.id ? requirement : i)))
    } catch {
      setItems((all) => all.map((i) => (i.id === prev.id ? prev : i)))
    } finally {
      setStatusUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row: filters + add */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'h-7 px-2.5 rounded-full text-xs font-medium transition-colors',
              categoryFilter === 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            All ({items.length})
          </button>
          {REQUIREMENT_CATEGORIES.map((cat) => {
            const count = items.filter((i) => i.category === cat).length
            if (count === 0) return null
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'h-7 px-2.5 rounded-full text-xs font-medium transition-colors',
                  categoryFilter === cat
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {REQUIREMENT_CATEGORY_LABELS[cat]} ({count})
              </button>
            )
          })}
          {projectIdsInUse.length > 0 && (
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="h-7 rounded-full border border-input bg-background px-2 text-xs font-medium text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All deals</option>
              <option value="standard">Standard (every deal)</option>
              {projectIdsInUse.map((pid) => (
                <option key={pid} value={pid}>
                  {projectsById[pid]?.name ?? 'Unknown project'}
                </option>
              ))}
            </select>
          )}
        </div>
        {mode === 'list' && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            <Plus size={13} />
            Add Requirement
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {(mode === 'add' || mode === 'edit') && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {mode === 'add' ? 'Add Requirement' : 'Edit Requirement'}
            </h4>
            <button
              onClick={cancelForm}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Category">
              <select
                value={form.category}
                onChange={(e) => setField('category', e.target.value as RequirementCategory)}
                className={inputCls}
              >
                {REQUIREMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {REQUIREMENT_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Status">
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as RequirementStatus)}
                className={inputCls}
              >
                {REQUIREMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REQUIREMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Item">
            <textarea
              value={form.item}
              onChange={(e) => setField('item', e.target.value)}
              rows={2}
              placeholder="What does this investor/lender need from us?"
              className={cn(inputCls, 'resize-y')}
              autoFocus={mode === 'add'}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="For Project">
              <select
                value={form.project_id}
                onChange={(e) => setField('project_id', e.target.value)}
                className={inputCls}
              >
                <option value="">— Standard requirement (every deal) —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            {documents.length > 0 && (
              <FormField label="Evidence Document">
                <select
                  value={form.evidence_doc_id}
                  onChange={(e) => setField('evidence_doc_id', e.target.value)}
                  className={inputCls}
                >
                  <option value="">— No document linked —</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.file_name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>

          <FormField label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              rows={2}
              placeholder="Specifics — e.g. 'last 2 months of statements', 'all 10%+ owners'..."
              className={cn(inputCls, 'resize-y')}
            />
          </FormField>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {mode === 'add' ? 'Add Requirement' : 'Save Changes'}
            </button>
            <button
              onClick={cancelForm}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
            {mode === 'edit' && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {items.length === 0
            ? 'No requirements tracked yet.'
            : 'No requirements match this filter.'}
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-muted border-b border-border">
                {['Category', 'Item', 'Status', 'Project', 'Evidence', ''].map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-r last:border-r-0 border-border whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const project = item.project_id ? projectsById[item.project_id] : null
                const evidenceDoc = item.evidence_doc_id ? docsById[item.evidence_doc_id] : null
                const status = (item.status as RequirementStatus) ?? 'needed'

                return (
                  <tr
                    key={item.id}
                    className="group border-b last:border-b-0 border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-3 py-3 border-r border-border whitespace-nowrap">
                      <span className="text-xs font-medium">
                        {REQUIREMENT_CATEGORY_LABELS[(item.category as RequirementCategory)] ??
                          item.category}
                      </span>
                    </td>
                    <td className="px-3 py-3 border-r border-border">
                      <p className="text-sm text-foreground leading-snug">{item.item}</p>
                      {item.notes && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 border-r border-border whitespace-nowrap">
                      {statusUpdatingId === item.id ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      ) : (
                        <select
                          value={status}
                          onChange={(e) => updateStatus(item, e.target.value as RequirementStatus)}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide cursor-pointer border focus:outline-none focus:ring-1 focus:ring-ring',
                            STATUS_SELECT_CLS[status]
                          )}
                        >
                          {REQUIREMENT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {REQUIREMENT_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-3 border-r border-border whitespace-nowrap">
                      {project ? (
                        <span className="text-xs font-medium">{project.name}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Standard</span>
                      )}
                    </td>
                    <td className="px-3 py-3 border-r border-border">
                      {evidenceDoc ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
                          <FileText size={12} className="shrink-0" />
                          <span className="truncate max-w-[120px]">{evidenceDoc.file_name}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={() => openEdit(item)}
                        className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
