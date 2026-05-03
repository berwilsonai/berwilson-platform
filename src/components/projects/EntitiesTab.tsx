'use client'

import { useState } from 'react'
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Link2,
  Link2Off,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/shared/EmptyState'
import ResearchPanel from './ResearchPanel'
import type { Entity, EntityProject, ResearchArtifact } from '@/lib/supabase/types'
import type { EntityType } from '@/lib/supabase/types'

// ── Types ────────────────────────────────────────────────────────────────────

export type EntityProjectWithEntity = EntityProject & { entity: Entity }

type TreeNode = Entity & { children: TreeNode[] }

type Mode =
  | { type: 'view' }
  | { type: 'link'; preselectedEntityId?: string }
  | { type: 'edit-link'; ep: EntityProjectWithEntity }
  | { type: 'create-entity' }
  | { type: 'edit-entity'; entity: Entity }
  | { type: 'research-entity'; entity: Entity }

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITY_TYPES: EntityType[] = ['llc', 'corp', 'jv', 'subsidiary', 'trust', 'fund', 'other']

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  llc: 'LLC',
  corp: 'Corp',
  jv: 'JV',
  subsidiary: 'Subsidiary',
  trust: 'Trust',
  fund: 'Fund',
  other: 'Other',
}

const ENTITY_TYPE_STYLES: Record<EntityType, string> = {
  llc: 'bg-blue-50 text-blue-700 ring-blue-200',
  corp: 'bg-violet-50 text-violet-700 ring-violet-200',
  jv: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  subsidiary: 'bg-amber-50 text-amber-700 ring-amber-200',
  trust: 'bg-rose-50 text-rose-700 ring-rose-200',
  fund: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  other: 'bg-slate-50 text-slate-600 ring-slate-200',
}

const RELATIONSHIPS = ['owner', 'jv_partner', 'sub_entity', 'guarantor', 'vendor', 'subcontractor', 'consultant', 'partner'] as const
type Relationship = typeof RELATIONSHIPS[number]

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  owner: 'Owner',
  jv_partner: 'JV Partner',
  sub_entity: 'Sub-Entity',
  guarantor: 'Guarantor',
  vendor: 'Vendor',
  subcontractor: 'Subcontractor',
  consultant: 'Consultant',
  partner: 'Partner',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTree(entities: Entity[]): TreeNode[] {
  const map: Record<string, TreeNode> = {}
  const roots: TreeNode[] = []
  for (const e of entities) map[e.id] = { ...e, children: [] }
  for (const e of entities) {
    if (e.parent_entity_id && map[e.parent_entity_id]) {
      map[e.parent_entity_id].children.push(map[e.id])
    } else {
      roots.push(map[e.id])
    }
  }
  return roots
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return ''
  return `${n}%`
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

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

function EntityTypeBadge({ type }: { type: EntityType }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        ENTITY_TYPE_STYLES[type]
      )}
    >
      {ENTITY_TYPE_LABELS[type]}
    </span>
  )
}

// ── Entity form fields (shared by create + edit) ───────────────────────────

type EntityForm = {
  name: string
  entity_type: EntityType
  jurisdiction: string
  parent_entity_id: string
  ownership_pct: string
  formation_date: string
  ein: string
  notes: string
}

function emptyEntityForm(): EntityForm {
  return {
    name: '',
    entity_type: 'llc',
    jurisdiction: '',
    parent_entity_id: '',
    ownership_pct: '',
    formation_date: '',
    ein: '',
    notes: '',
  }
}

function entityToForm(e: Entity): EntityForm {
  return {
    name: e.name,
    entity_type: e.entity_type,
    jurisdiction: e.jurisdiction ?? '',
    parent_entity_id: e.parent_entity_id ?? '',
    ownership_pct: e.ownership_pct != null ? String(e.ownership_pct) : '',
    formation_date: e.formation_date ?? '',
    ein: e.ein ?? '',
    notes: e.notes ?? '',
  }
}

function EntityFormFields({
  form,
  setField,
  allEntities,
  excludeId,
}: {
  form: EntityForm
  setField: <K extends keyof EntityForm>(k: K, v: EntityForm[K]) => void
  allEntities: Entity[]
  excludeId?: string
}) {
  const parentOptions = allEntities.filter((e) => e.id !== excludeId)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Legal Name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="e.g. Ber Wilson Holdings LLC"
            className={cn(inputCls, 'col-span-2')}
            autoFocus
          />
        </FormField>
        <FormField label="Entity Type">
          <select
            value={form.entity_type}
            onChange={(e) => setField('entity_type', e.target.value as EntityType)}
            className={inputCls}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ENTITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Jurisdiction">
          <input
            type="text"
            value={form.jurisdiction}
            onChange={(e) => setField('jurisdiction', e.target.value)}
            placeholder="e.g. Delaware, Utah"
            className={inputCls}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Parent Entity">
          <select
            value={form.parent_entity_id}
            onChange={(e) => setField('parent_entity_id', e.target.value)}
            className={inputCls}
          >
            <option value="">— None (root entity) —</option>
            {parentOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({ENTITY_TYPE_LABELS[e.entity_type]})
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Ownership %">
          <div className="relative">
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={form.ownership_pct}
              onChange={(e) => setField('ownership_pct', e.target.value)}
              placeholder="e.g. 51"
              className={cn(inputCls, 'pr-7')}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
              %
            </span>
          </div>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Formation Date">
          <input
            type="date"
            value={form.formation_date}
            onChange={(e) => setField('formation_date', e.target.value)}
            className={cn(inputCls, 'text-muted-foreground')}
          />
        </FormField>
        <FormField label="EIN">
          <input
            type="text"
            value={form.ein}
            onChange={(e) => setField('ein', e.target.value)}
            placeholder="XX-XXXXXXX"
            className={inputCls}
          />
        </FormField>
      </div>

      <FormField label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => setField('notes', e.target.value)}
          rows={2}
          placeholder="Ownership structure, purpose, any relevant context..."
          className={cn(inputCls, 'resize-y')}
        />
      </FormField>
    </div>
  )
}

// ── Tree node (recursive) ─────────────────────────────────────────────────────

function EntityTreeNode({
  node,
  depth,
  linkedIds,
  onEdit,
  onLinkDirect,
  onResearch,
}: {
  node: TreeNode
  depth: number
  linkedIds: Set<string>
  onEdit: (entity: Entity) => void
  onLinkDirect: (entityId: string) => void
  onResearch: (entity: Entity) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const isLinked = linkedIds.has(node.id)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors group',
          depth > 0 && 'ml-4'
        )}
        style={depth > 0 ? { borderLeft: '2px solid var(--border)', marginLeft: depth * 16, paddingLeft: 12 } : {}}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}

        <EntityTypeBadge type={node.entity_type} />

        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {node.name}
        </span>

        {node.jurisdiction && (
          <span className="text-[11px] text-muted-foreground hidden sm:block shrink-0">
            {node.jurisdiction}
          </span>
        )}

        {node.ownership_pct != null && (
          <span className="text-[11px] text-muted-foreground shrink-0">
            {node.ownership_pct}%
          </span>
        )}

        {isLinked && (
          <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">
            On project
          </span>
        )}

        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {!isLinked && (
            <button
              onClick={() => onLinkDirect(node.id)}
              title="Link to this project"
              className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-colors"
            >
              <Link2 size={11} />
              Link
            </button>
          )}
          <button
            onClick={() => onResearch(node)}
            title="Research this entity"
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-colors"
          >
            <Search size={11} />
            Research
          </button>
          <button
            onClick={() => onEdit(node)}
            title="Edit entity"
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>

      {expanded &&
        node.children.map((child) => (
          <EntityTreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            linkedIds={linkedIds}
            onEdit={onEdit}
            onLinkDirect={onLinkDirect}
            onResearch={onResearch}
          />
        ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface EntitiesTabProps {
  projectId: string
  initialLinked: EntityProjectWithEntity[]
  initialAllEntities: Entity[]
  initialResearchArtifacts?: ResearchArtifact[]
}

export default function EntitiesTab({
  projectId,
  initialLinked,
  initialAllEntities,
  initialResearchArtifacts = [],
}: EntitiesTabProps) {
  const [linked, setLinked] = useState<EntityProjectWithEntity[]>(initialLinked)
  const [allEntities, setAllEntities] = useState<Entity[]>(initialAllEntities)
  const [mode, setMode] = useState<Mode>({ type: 'view' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Link form state ──────────────────────────────────────────────────────
  const [linkForm, setLinkForm] = useState({
    entity_id: '',
    relationship: 'owner' as Relationship,
    equity_pct: '',
    notes: '',
  })

  // ── Entity form state ────────────────────────────────────────────────────
  const [entityForm, setEntityForm] = useState<EntityForm>(emptyEntityForm())

  function setLinkField<K extends keyof typeof linkForm>(k: K, v: (typeof linkForm)[K]) {
    setLinkForm((prev) => ({ ...prev, [k]: v }))
  }

  function setEntityField<K extends keyof EntityForm>(k: K, v: EntityForm[K]) {
    setEntityForm((prev) => ({ ...prev, [k]: v }))
  }

  function openLink(preselectedEntityId?: string) {
    setLinkForm({
      entity_id: preselectedEntityId ?? '',
      relationship: 'owner',
      equity_pct: '',
      notes: '',
    })
    setError(null)
    setMode({ type: 'link', preselectedEntityId })
  }

  function openEditLink(ep: EntityProjectWithEntity) {
    setLinkForm({
      entity_id: ep.entity_id,
      relationship: ep.relationship as Relationship,
      equity_pct: ep.equity_pct != null ? String(ep.equity_pct) : '',
      notes: ep.notes ?? '',
    })
    setError(null)
    setMode({ type: 'edit-link', ep })
  }

  function openCreate() {
    setEntityForm(emptyEntityForm())
    setError(null)
    setMode({ type: 'create-entity' })
  }

  function openEdit(entity: Entity) {
    setEntityForm(entityToForm(entity))
    setError(null)
    setMode({ type: 'edit-entity', entity })
  }

  function openResearch(entity: Entity) {
    setError(null)
    setMode({ type: 'research-entity', entity })
  }

  function cancel() {
    setMode({ type: 'view' })
    setError(null)
  }

  // ── API handlers ─────────────────────────────────────────────────────────

  async function handleLink() {
    if (!linkForm.entity_id) {
      setError('Please select an entity.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/entity-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_id: linkForm.entity_id,
          project_id: projectId,
          relationship: linkForm.relationship,
          equity_pct: linkForm.equity_pct || null,
          notes: linkForm.notes || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Link failed')
      }
      const { entityProject } = await res.json()
      setLinked((prev) => [...prev, entityProject as EntityProjectWithEntity])
      setMode({ type: 'view' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateLink(ep: EntityProjectWithEntity) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/entity-projects/${ep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationship: linkForm.relationship,
          equity_pct: linkForm.equity_pct || null,
          notes: linkForm.notes || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Update failed')
      }
      const { entityProject } = await res.json()
      setLinked((prev) =>
        prev.map((p) => (p.id === ep.id ? (entityProject as EntityProjectWithEntity) : p))
      )
      setMode({ type: 'view' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleUnlink(ep: EntityProjectWithEntity) {
    if (!confirm(`Remove ${ep.entity.name} from this project?`)) return
    try {
      const res = await fetch(`/api/entity-projects/${ep.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Unlink failed')
      setLinked((prev) => prev.filter((p) => p.id !== ep.id))
    } catch {
      alert('Failed to unlink entity.')
    }
  }

  async function handleSaveEntity() {
    if (!entityForm.name.trim()) {
      setError('Entity name is required.')
      return
    }
    setSaving(true)
    setError(null)

    const isEdit = mode.type === 'edit-entity'
    const editId = isEdit ? (mode as { type: 'edit-entity'; entity: Entity }).entity.id : null

    try {
      const res = await fetch(isEdit ? `/api/entities/${editId}` : '/api/entities', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: entityForm.name,
          entity_type: entityForm.entity_type,
          jurisdiction: entityForm.jurisdiction,
          parent_entity_id: entityForm.parent_entity_id || null,
          ownership_pct: entityForm.ownership_pct || null,
          formation_date: entityForm.formation_date || null,
          ein: entityForm.ein,
          notes: entityForm.notes,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Save failed')
      }
      const { entity } = await res.json()
      if (isEdit) {
        setAllEntities((prev) => prev.map((e) => (e.id === entity.id ? entity : e)))
        // Update entity info in linked list too
        setLinked((prev) =>
          prev.map((ep) => (ep.entity_id === entity.id ? { ...ep, entity } : ep))
        )
      } else {
        setAllEntities((prev) =>
          [...prev, entity].sort((a, b) => a.name.localeCompare(b.name))
        )
      }
      setMode({ type: 'view' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEntity(entity: Entity) {
    if (!confirm(`Delete "${entity.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/entities/${entity.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Delete failed')
      }
      setAllEntities((prev) => prev.filter((e) => e.id !== entity.id))
      setLinked((prev) => prev.filter((ep) => ep.entity_id !== entity.id))
      setMode({ type: 'view' })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const linkedIds = new Set(linked.map((ep) => ep.entity_id))
  const unlinkable = allEntities.filter((e) => !linkedIds.has(e.id))
  const tree = buildTree(allEntities)

  // ── Research mode ─────────────────────────────────────────────────────────

  if (mode.type === 'research-entity') {
    const entity = (mode as { type: 'research-entity'; entity: Entity }).entity
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{entity.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">External research &amp; due diligence</p>
          </div>
          <button
            onClick={cancel}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            <X size={13} />
            Back to Entities
          </button>
        </div>
        <ResearchPanel
          projectId={projectId}
          projectName={entity.name}
          clientEntity={entity.name}
          initialArtifacts={initialResearchArtifacts}
        />
      </div>
    )
  }

  // ── Full-page form modes ──────────────────────────────────────────────────

  if (mode.type === 'create-entity' || mode.type === 'edit-entity') {
    const isEdit = mode.type === 'edit-entity'
    const editEntity = isEdit ? (mode as { type: 'edit-entity'; entity: Entity }).entity : null

    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {isEdit ? `Edit Entity — ${editEntity!.name}` : 'New Entity'}
          </h2>
        </div>

        <EntityFormFields
          form={entityForm}
          setField={setEntityField}
          allEntities={allEntities}
          excludeId={editEntity?.id}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 border-t border-border pt-5">
          <button
            onClick={handleSaveEntity}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {isEdit ? 'Save Changes' : 'Create Entity'}
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <X size={14} />
            Cancel
          </button>
          {isEdit && editEntity && (
            <button
              onClick={() => handleDeleteEntity(editEntity)}
              className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── View mode (+ inline link/edit-link forms) ─────────────────────────────

  const isLinkMode = mode.type === 'link'
  const isEditLinkMode = mode.type === 'edit-link'

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Section 1: Linked to this project ─────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Linked to This Project
          </h2>
          {!isLinkMode && !isEditLinkMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => openLink()}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
              >
                <Link2 size={12} />
                Link Entity
              </button>
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={12} />
                New Entity
              </button>
            </div>
          )}
        </div>

        {/* Inline link form */}
        {isLinkMode && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
            <p className="text-sm font-medium">Link Entity to Project</p>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Entity">
                <select
                  value={linkForm.entity_id}
                  onChange={(e) => setLinkField('entity_id', e.target.value)}
                  className={inputCls}
                  autoFocus
                >
                  <option value="">Select entity…</option>
                  {allEntities.map((e) => (
                    <option key={e.id} value={e.id} disabled={linkedIds.has(e.id)}>
                      {e.name} ({ENTITY_TYPE_LABELS[e.entity_type]})
                      {linkedIds.has(e.id) ? ' — already linked' : ''}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Relationship">
                <select
                  value={linkForm.relationship}
                  onChange={(e) => setLinkField('relationship', e.target.value as Relationship)}
                  className={inputCls}
                >
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {RELATIONSHIP_LABELS[r]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Equity %">
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={linkForm.equity_pct}
                    onChange={(e) => setLinkField('equity_pct', e.target.value)}
                    placeholder="Optional"
                    className={cn(inputCls, 'pr-7')}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                    %
                  </span>
                </div>
              </FormField>
              <FormField label="Notes">
                <input
                  type="text"
                  value={linkForm.notes}
                  onChange={(e) => setLinkField('notes', e.target.value)}
                  placeholder="Optional"
                  className={inputCls}
                />
              </FormField>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={handleLink}
                disabled={saving}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                Link
              </button>
              <button
                onClick={cancel}
                disabled={saving}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
              >
                <X size={13} />
                Cancel
              </button>
              {unlinkable.length === 0 && allEntities.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  All entities are already linked.
                </span>
              )}
            </div>
          </div>
        )}

        {/* Linked entities list */}
        {linked.length === 0 && !isLinkMode ? (
          <EmptyState
            icon={Building2}
            title="No entities linked"
            description="Link LLCs, JV structures, or other legal entities involved in this project."
          />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {linked.map((ep) => {
              const isEditingThis = isEditLinkMode &&
                (mode as { type: 'edit-link'; ep: EntityProjectWithEntity }).ep.id === ep.id

              return (
                <div key={ep.id} className="border-b last:border-b-0 border-border">
                  {isEditingThis ? (
                    /* Inline edit form for this row */
                    <div className="p-4 space-y-3 bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground">
                        Edit — {ep.entity.name}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField label="Relationship">
                          <select
                            value={linkForm.relationship}
                            onChange={(e) => setLinkField('relationship', e.target.value as Relationship)}
                            className={inputCls}
                            autoFocus
                          >
                            {RELATIONSHIPS.map((r) => (
                              <option key={r} value={r}>
                                {RELATIONSHIP_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </FormField>
                        <FormField label="Equity %">
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={linkForm.equity_pct}
                              onChange={(e) => setLinkField('equity_pct', e.target.value)}
                              placeholder="Optional"
                              className={cn(inputCls, 'pr-7')}
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                              %
                            </span>
                          </div>
                        </FormField>
                        <div className="col-span-2">
                          <FormField label="Notes">
                            <input
                              type="text"
                              value={linkForm.notes}
                              onChange={(e) => setLinkField('notes', e.target.value)}
                              placeholder="Optional"
                              className={inputCls}
                            />
                          </FormField>
                        </div>
                      </div>
                      {error && <p className="text-sm text-red-600">{error}</p>}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUpdateLink(ep)}
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                        >
                          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          Save
                        </button>
                        <button
                          onClick={cancel}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
                        >
                          <X size={13} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Normal row */
                    <div className="flex items-center gap-3 px-4 py-3 group hover:bg-muted/30 transition-colors">
                      <EntityTypeBadge type={ep.entity.entity_type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{ep.entity.name}</p>
                        {ep.entity.jurisdiction && (
                          <p className="text-[11px] text-muted-foreground">{ep.entity.jurisdiction}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {RELATIONSHIP_LABELS[ep.relationship as Relationship] ?? ep.relationship}
                      </span>
                      {ep.equity_pct != null && (
                        <span className="text-xs font-medium text-foreground shrink-0 tabular-nums">
                          {ep.equity_pct}%
                        </span>
                      )}
                      {ep.notes && (
                        <span className="text-[11px] text-muted-foreground truncate max-w-[120px] hidden sm:block">
                          {ep.notes}
                        </span>
                      )}
                      {/* Row actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => openEditLink(ep)}
                          title="Edit link"
                          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleUnlink(ep)}
                          title="Remove from project"
                          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Link2Off size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Section 2: Corporate Structure Tree ───────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Corporate Structure
          </h2>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            <Plus size={12} />
            New Entity
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          All entities in your system. Hover to edit or link to this project.
        </p>

        {allEntities.length === 0 ? (
          <div className="rounded-lg border border-border p-6 text-center">
            <Building2 size={28} className="mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No entities yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Create your first entity to start mapping the corporate structure.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-2 space-y-0.5">
            {tree.map((root) => (
              <EntityTreeNode
                key={root.id}
                node={root}
                depth={0}
                linkedIds={linkedIds}
                onEdit={openEdit}
                onLinkDirect={(entityId) => openLink(entityId)}
                onResearch={openResearch}
              />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
