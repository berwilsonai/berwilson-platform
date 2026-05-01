'use client'

import { useState } from 'react'
import {
  Plus,
  Pencil,
  Check,
  X,
  Loader2,
  ShieldCheck,
  FileCheck,
  FileText,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DdItem, ComplianceItem, Party, Document, DdSeverity, ComplianceStatus } from '@/lib/supabase/types'

// ── Constants ──────────────────────────────────────────────────────────────────

const DD_CATEGORIES = ['legal', 'regulatory', 'partner_dd', 'title', 'environmental', 'bonding'] as const

const CATEGORY_LABELS: Record<string, string> = {
  legal: 'Legal',
  regulatory: 'Regulatory',
  partner_dd: 'Partner DD',
  title: 'Title',
  environmental: 'Environmental',
  bonding: 'Bonding',
}

const DD_STATUSES = ['open', 'in_progress', 'resolved', 'accepted_risk'] as const

const DD_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  accepted_risk: 'Accepted Risk',
}

const SEVERITIES: DdSeverity[] = ['info', 'watch', 'critical', 'blocker']

const SEVERITY_LABELS: Record<DdSeverity, string> = {
  info: 'Info',
  watch: 'Watch',
  critical: 'Critical',
  blocker: 'Blocker',
}

const COMPLIANCE_FRAMEWORKS = [
  'cmmc',
  'davis_bacon',
  'bonding',
  'dbe_eeo',
  'far_dfars',
  'state_license',
] as const

const FRAMEWORK_LABELS: Record<string, string> = {
  cmmc: 'CMMC',
  davis_bacon: 'Davis-Bacon',
  bonding: 'Bonding',
  dbe_eeo: 'DBE/EEO',
  far_dfars: 'FAR/DFARS',
  state_license: 'State License',
}

const COMPLIANCE_STATUSES: ComplianceStatus[] = [
  'not_started',
  'in_progress',
  'compliant',
  'non_compliant',
  'waived',
]

const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  compliant: 'Compliant',
  non_compliant: 'Non-Compliant',
  waived: 'Waived',
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: DdSeverity }) {
  const cls = {
    info: 'bg-blue-50 text-blue-700 ring-blue-200',
    watch: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
    critical: 'bg-orange-50 text-orange-700 ring-orange-200',
    blocker: 'bg-red-50 text-red-700 ring-red-200',
  }[severity]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        cls
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

const DD_STATUS_SELECT_CLS: Record<string, string> = {
  open: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted_risk: 'bg-amber-50 text-amber-700 border-amber-200',
}

const COMPLIANCE_STATUS_SELECT_CLS: Record<ComplianceStatus, string> = {
  not_started: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  compliant: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  non_compliant: 'bg-red-50 text-red-700 border-red-200',
  waived: 'bg-purple-50 text-purple-700 border-purple-200',
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

// ── Shared form field ──────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

// ── DD Items section ───────────────────────────────────────────────────────────

type DdFormState = {
  category: string
  item: string
  severity: DdSeverity
  status: string
  assigned_to: string
  notes: string
}

function emptyDdForm(): DdFormState {
  return { category: 'legal', item: '', severity: 'info', status: 'open', assigned_to: '', notes: '' }
}

function ddItemToForm(d: DdItem): DdFormState {
  return {
    category: d.category,
    item: d.item,
    severity: d.severity ?? 'info',
    status: d.status ?? 'open',
    assigned_to: d.assigned_to ?? '',
    notes: d.notes ?? '',
  }
}

interface DdSectionProps {
  projectId: string
  initialItems: DdItem[]
  parties: Party[]
}

function DdSection({ projectId, initialItems, parties }: DdSectionProps) {
  const [items, setItems] = useState(initialItems)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<DdFormState>(emptyDdForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  const partiesById = Object.fromEntries(parties.map((p) => [p.id, p]))
  const filtered = categoryFilter === 'all' ? items : items.filter((i) => i.category === categoryFilter)

  function setField<K extends keyof DdFormState>(key: K, value: DdFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function openAdd() {
    setForm(emptyDdForm())
    setEditId(null)
    setError(null)
    setMode('add')
  }

  function openEdit(item: DdItem) {
    setForm(ddItemToForm(item))
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
      setError('Item description is required')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      category: form.category,
      item: form.item.trim(),
      severity: form.severity,
      status: form.status,
      assigned_to: form.assigned_to || null,
      notes: form.notes.trim() || null,
    }

    try {
      let res: Response
      if (mode === 'edit' && editId) {
        res = await fetch(`/api/dd-items/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/dd-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, ...payload }),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }

      const { dd_item } = await res.json()
      if (mode === 'edit') {
        setItems((prev) => prev.map((i) => (i.id === dd_item.id ? dd_item : i)))
      } else {
        setItems((prev) => [dd_item, ...prev])
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
      const res = await fetch(`/api/dd-items/${editId}`, { method: 'DELETE' })
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

  async function updateStatus(item: DdItem, newStatus: string) {
    const prev = item
    setStatusUpdatingId(item.id)
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i)))

    try {
      const res = await fetch(`/api/dd-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        setItems((all) => all.map((i) => (i.id === prev.id ? prev : i)))
        return
      }
      const { dd_item } = await res.json()
      setItems((all) => all.map((i) => (i.id === dd_item.id ? dd_item : i)))
    } catch {
      setItems((all) => all.map((i) => (i.id === prev.id ? prev : i)))
    } finally {
      setStatusUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-semibold">Due Diligence Items</h3>
        {mode === 'list' && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            <Plus size={13} />
            Add Item
          </button>
        )}
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-1.5">
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
        {DD_CATEGORIES.map((cat) => {
          const count = items.filter((i) => i.category === cat).length
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
              {CATEGORY_LABELS[cat]}
              {count > 0 && ` (${count})`}
            </button>
          )
        })}
      </div>

      {/* Add / Edit form */}
      {(mode === 'add' || mode === 'edit') && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {mode === 'add' ? 'Add DD Item' : 'Edit DD Item'}
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
                onChange={(e) => setField('category', e.target.value)}
                className={inputCls}
              >
                {DD_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Severity">
              <select
                value={form.severity}
                onChange={(e) => setField('severity', e.target.value as DdSeverity)}
                className={inputCls}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Item">
            <textarea
              value={form.item}
              onChange={(e) => setField('item', e.target.value)}
              rows={3}
              placeholder="Describe the due diligence item..."
              className={cn(inputCls, 'resize-y')}
              autoFocus={mode === 'add'}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Status">
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
                className={inputCls}
              >
                {DD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DD_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </FormField>
            {parties.length > 0 && (
              <FormField label="Assigned To">
                <select
                  value={form.assigned_to}
                  onChange={(e) => setField('assigned_to', e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Unassigned —</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {p.company ? ` (${p.company})` : ''}
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
              placeholder="Additional notes or context..."
              className={cn(inputCls, 'resize-y')}
            />
          </FormField>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {mode === 'add' ? 'Add Item' : 'Save Changes'}
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
                className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
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
          {items.length === 0 ? 'No due diligence items yet.' : 'No items in this category.'}
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header row */}
          <div className="hidden md:grid grid-cols-[110px_1fr_72px_130px_150px_36px] bg-muted border-b border-border">
            {['Category', 'Item', 'Severity', 'Status', 'Assigned To', ''].map((h, i) => (
              <div
                key={i}
                className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-r last:border-r-0 border-border"
              >
                {h}
              </div>
            ))}
          </div>

          {/* Item rows */}
          {filtered.map((item) => {
            const assignee = item.assigned_to ? partiesById[item.assigned_to] : null
            const rowBg =
              item.severity === 'blocker'
                ? 'bg-red-50/40'
                : item.severity === 'critical'
                ? 'bg-orange-50/25'
                : ''

            return (
              <div
                key={item.id}
                className={cn(
                  'group grid grid-cols-1 md:grid-cols-[110px_1fr_72px_130px_150px_36px] border-b last:border-b-0 border-border',
                  rowBg
                )}
              >
                {/* Category */}
                <div className="px-3 py-3 flex items-center border-b md:border-b-0 md:border-r border-border">
                  <span className="text-xs font-medium text-muted-foreground">
                    {CATEGORY_LABELS[item.category] ?? item.category}
                  </span>
                </div>

                {/* Item text + notes */}
                <div className="px-3 py-3 border-b md:border-b-0 md:border-r border-border">
                  <p className="text-sm text-foreground leading-snug">{item.item}</p>
                  {item.notes && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
                  )}
                </div>

                {/* Severity badge */}
                <div className="px-3 py-3 flex items-center border-b md:border-b-0 md:border-r border-border">
                  <SeverityBadge severity={item.severity ?? 'info'} />
                </div>

                {/* Status quick-select */}
                <div className="px-3 py-3 flex items-center border-b md:border-b-0 md:border-r border-border">
                  {statusUpdatingId === item.id ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : (
                    <select
                      value={item.status ?? 'open'}
                      onChange={(e) => updateStatus(item, e.target.value)}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer border focus:outline-none focus:ring-1 focus:ring-ring',
                        DD_STATUS_SELECT_CLS[item.status ?? 'open']
                      )}
                    >
                      {DD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {DD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Assigned To */}
                <div className="px-3 py-3 flex items-center border-b md:border-b-0 md:border-r border-border">
                  {assignee ? (
                    <div>
                      <p className="text-xs font-medium text-foreground">{assignee.full_name}</p>
                      {assignee.company && (
                        <p className="text-[10px] text-muted-foreground">{assignee.company}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>

                {/* Edit button */}
                <div className="px-2 py-3 flex items-center justify-center">
                  <button
                    onClick={() => openEdit(item)}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Compliance section ─────────────────────────────────────────────────────────

type ComplianceFormState = {
  framework: string
  requirement: string
  status: ComplianceStatus
  due_date: string
  responsible_party: string
  evidence_doc_id: string
  notes: string
}

function emptyComplianceForm(): ComplianceFormState {
  return {
    framework: 'cmmc',
    requirement: '',
    status: 'not_started',
    due_date: '',
    responsible_party: '',
    evidence_doc_id: '',
    notes: '',
  }
}

function complianceItemToForm(c: ComplianceItem): ComplianceFormState {
  return {
    framework: c.framework,
    requirement: c.requirement,
    status: c.status ?? 'not_started',
    due_date: c.due_date ?? '',
    responsible_party: c.responsible_party ?? '',
    evidence_doc_id: c.evidence_doc_id ?? '',
    notes: c.notes ?? '',
  }
}

interface ComplianceSectionProps {
  projectId: string
  initialItems: ComplianceItem[]
  parties: Party[]
  documents: Document[]
}

function ComplianceSection({
  projectId,
  initialItems,
  parties,
  documents,
}: ComplianceSectionProps) {
  const [items, setItems] = useState(initialItems)
  const [frameworkFilter, setFrameworkFilter] = useState('all')
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ComplianceFormState>(emptyComplianceForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  const partiesById = Object.fromEntries(parties.map((p) => [p.id, p]))
  const docsById = Object.fromEntries(documents.map((d) => [d.id, d]))
  const filtered =
    frameworkFilter === 'all' ? items : items.filter((i) => i.framework === frameworkFilter)

  function setField<K extends keyof ComplianceFormState>(key: K, value: ComplianceFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function openAdd() {
    setForm(emptyComplianceForm())
    setEditId(null)
    setError(null)
    setMode('add')
  }

  function openEdit(item: ComplianceItem) {
    setForm(complianceItemToForm(item))
    setEditId(item.id)
    setError(null)
    setMode('edit')
  }

  function cancelForm() {
    setMode('list')
    setError(null)
  }

  async function handleSave() {
    if (!form.requirement.trim()) {
      setError('Requirement is required')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      framework: form.framework,
      requirement: form.requirement.trim(),
      status: form.status,
      due_date: form.due_date || null,
      responsible_party: form.responsible_party || null,
      evidence_doc_id: form.evidence_doc_id || null,
      notes: form.notes.trim() || null,
    }

    try {
      let res: Response
      if (mode === 'edit' && editId) {
        res = await fetch(`/api/compliance-items/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/compliance-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, ...payload }),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }

      const { compliance_item } = await res.json()
      if (mode === 'edit') {
        setItems((prev) => prev.map((i) => (i.id === compliance_item.id ? compliance_item : i)))
      } else {
        setItems((prev) => [compliance_item, ...prev])
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
      const res = await fetch(`/api/compliance-items/${editId}`, { method: 'DELETE' })
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

  async function updateStatus(item: ComplianceItem, newStatus: ComplianceStatus) {
    const prev = item
    setStatusUpdatingId(item.id)
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i)))

    try {
      const res = await fetch(`/api/compliance-items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        setItems((all) => all.map((i) => (i.id === prev.id ? prev : i)))
        return
      }
      const { compliance_item } = await res.json()
      setItems((all) => all.map((i) => (i.id === compliance_item.id ? compliance_item : i)))
    } catch {
      setItems((all) => all.map((i) => (i.id === prev.id ? prev : i)))
    } finally {
      setStatusUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-sm font-semibold">Compliance Items</h3>
        {mode === 'list' && (
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            <Plus size={13} />
            Add Item
          </button>
        )}
      </div>

      {/* Framework filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFrameworkFilter('all')}
          className={cn(
            'h-7 px-2.5 rounded-full text-xs font-medium transition-colors',
            frameworkFilter === 'all'
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          )}
        >
          All ({items.length})
        </button>
        {COMPLIANCE_FRAMEWORKS.map((fw) => {
          const count = items.filter((i) => i.framework === fw).length
          return (
            <button
              key={fw}
              onClick={() => setFrameworkFilter(fw)}
              className={cn(
                'h-7 px-2.5 rounded-full text-xs font-medium transition-colors',
                frameworkFilter === fw
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {FRAMEWORK_LABELS[fw]}
              {count > 0 && ` (${count})`}
            </button>
          )
        })}
      </div>

      {/* Add / Edit form */}
      {(mode === 'add' || mode === 'edit') && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              {mode === 'add' ? 'Add Compliance Item' : 'Edit Compliance Item'}
            </h4>
            <button
              onClick={cancelForm}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Framework">
              <select
                value={form.framework}
                onChange={(e) => setField('framework', e.target.value)}
                className={inputCls}
              >
                {COMPLIANCE_FRAMEWORKS.map((fw) => (
                  <option key={fw} value={fw}>
                    {FRAMEWORK_LABELS[fw]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Status">
              <select
                value={form.status}
                onChange={(e) => setField('status', e.target.value as ComplianceStatus)}
                className={inputCls}
              >
                {COMPLIANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {COMPLIANCE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Requirement">
            <textarea
              value={form.requirement}
              onChange={(e) => setField('requirement', e.target.value)}
              rows={3}
              placeholder="Describe the compliance requirement..."
              className={cn(inputCls, 'resize-y')}
              autoFocus={mode === 'add'}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Due Date">
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setField('due_date', e.target.value)}
                className={inputCls}
              />
            </FormField>
            {parties.length > 0 && (
              <FormField label="Responsible Party">
                <select
                  value={form.responsible_party}
                  onChange={(e) => setField('responsible_party', e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Unassigned —</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {p.company ? ` (${p.company})` : ''}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>

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

          <FormField label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              rows={2}
              placeholder="Additional notes or context..."
              className={cn(inputCls, 'resize-y')}
            />
          </FormField>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {mode === 'add' ? 'Add Item' : 'Save Changes'}
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
                className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
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
          {items.length === 0 ? 'No compliance items yet.' : 'No items for this framework.'}
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-muted border-b border-border">
                {[
                  'Framework',
                  'Requirement',
                  'Status',
                  'Due Date',
                  'Responsible Party',
                  'Evidence',
                  '',
                ].map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-r last:border-r-0 border-border whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const responsible = item.responsible_party
                  ? partiesById[item.responsible_party]
                  : null
                const evidenceDoc = item.evidence_doc_id ? docsById[item.evidence_doc_id] : null

                return (
                  <tr
                    key={item.id}
                    className="group border-b last:border-b-0 border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-3 py-3 border-r border-border whitespace-nowrap">
                      <span className="text-xs font-medium">
                        {FRAMEWORK_LABELS[item.framework] ?? item.framework}
                      </span>
                    </td>
                    <td className="px-3 py-3 border-r border-border">
                      <p className="text-sm text-foreground leading-snug">{item.requirement}</p>
                      {item.notes && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 border-r border-border whitespace-nowrap">
                      {statusUpdatingId === item.id ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      ) : (
                        <select
                          value={item.status ?? 'not_started'}
                          onChange={(e) =>
                            updateStatus(item, e.target.value as ComplianceStatus)
                          }
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer border focus:outline-none focus:ring-1 focus:ring-ring',
                            COMPLIANCE_STATUS_SELECT_CLS[item.status ?? 'not_started']
                          )}
                        >
                          {COMPLIANCE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {COMPLIANCE_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-3 border-r border-border whitespace-nowrap">
                      <span
                        className={cn(
                          'text-sm',
                          !item.due_date && 'text-muted-foreground'
                        )}
                      >
                        {formatDate(item.due_date)}
                      </span>
                    </td>
                    <td className="px-3 py-3 border-r border-border">
                      {responsible ? (
                        <div>
                          <p className="text-xs font-medium text-foreground">
                            {responsible.full_name}
                          </p>
                          {responsible.company && (
                            <p className="text-[10px] text-muted-foreground">
                              {responsible.company}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 border-r border-border">
                      {evidenceDoc ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
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

// ── Main DiligenceTab ──────────────────────────────────────────────────────────

export interface DiligenceTabProps {
  projectId: string
  initialDdItems: DdItem[]
  initialComplianceItems: ComplianceItem[]
  parties: Party[]
  documents: Document[]
}

export default function DiligenceTab({
  projectId,
  initialDdItems,
  initialComplianceItems,
  parties,
  documents,
}: DiligenceTabProps) {
  const [section, setSection] = useState<'dd' | 'compliance'>('dd')

  // Static counts from initial data — shows totals on section switcher
  const openDdCount = initialDdItems.filter(
    (i) => i.status === 'open' || i.status === 'in_progress'
  ).length
  const nonCompliantCount = initialComplianceItems.filter(
    (i) => i.status === 'non_compliant'
  ).length

  return (
    <div className="space-y-6">
      {/* Section switcher */}
      <div className="flex items-center gap-0 border-b border-border">
        <button
          onClick={() => setSection('dd')}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            section === 'dd'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          )}
        >
          <ShieldCheck size={15} />
          Due Diligence
          {openDdCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold">
              {openDdCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setSection('compliance')}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            section === 'compliance'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          )}
        >
          <FileCheck size={15} />
          Compliance
          {nonCompliantCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
              {nonCompliantCount}
            </span>
          )}
        </button>
      </div>

      {section === 'dd' && (
        <DdSection
          projectId={projectId}
          initialItems={initialDdItems}
          parties={parties}
        />
      )}

      {section === 'compliance' && (
        <ComplianceSection
          projectId={projectId}
          initialItems={initialComplianceItems}
          parties={parties}
          documents={documents}
        />
      )}
    </div>
  )
}
