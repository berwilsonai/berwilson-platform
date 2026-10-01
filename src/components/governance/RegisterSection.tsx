'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, Input, Select, Textarea, FieldDate, FormGrid, FormActions } from '@/components/ui/field'
import { enumLabel, formatDate, formatMoney } from '@/lib/utils/constants'
import { tone } from '@/lib/governance/constants'

/**
 * One register, rendered from a spec.
 *
 * ⚠ WHY THIS IS SHARED AND NOT SIX COMPONENTS. The governance registers are the
 * same interaction six times over: list, add, edit, occasionally remove. Written
 * six times they drift — §12 has two separate rules about this, one about forking
 * a shared pass per table and one about a shared renderer that only one surface
 * ended up calling. So there is one renderer, every surface uses it, and the
 * difference between them is a column list and a field list.
 *
 * ⚠ AND IT IS WIRED TO EVERY SURFACE THAT SHOULD CALL IT. `BriefMarkdown` was
 * written so the printed brief would be the document read on screen, and only
 * the print route ever used it — the screen showed literal `##` under a `prose`
 * wrapper whose every selector was dead. Before adding a renderer, grep for one;
 * after adding one, grep for every surface that should call it.
 */

export type Option = { value: string; label: string }

export type FieldDef = {
  name: string
  label: string
  type: 'text' | 'textarea' | 'date' | 'money' | 'number' | 'bool' | 'tribool' | 'select'
  options?: Option[]
  hint?: string
  required?: boolean
  placeholder?: string
  /** Full-width in the form grid. */
  wide?: boolean
  /** Shown only when another field holds one of these values. */
  when?: { field: string; equals: unknown[] }
}

export type ColumnDef = {
  name: string
  label: string
  kind?: 'text' | 'date' | 'money' | 'number' | 'bool' | 'chip' | 'percent'
  labels?: Record<string, string>
  /** Tone NAMES keyed by the stored value. Never class strings (§12). */
  tones?: Record<string, string>
  /** Right-align — numbers read down a column, text does not. */
  numeric?: boolean
  /** Bold, and the cell a reader scans for. */
  primary?: boolean
  /** Anything the spec cannot express. Client-side, so a function is fine. */
  render?: (row: Row) => React.ReactNode
  /** Hide below `sm` — a phone gets the primary columns only. */
  secondary?: boolean
}

export type Row = Record<string, unknown>

interface RegisterSectionProps {
  title: string
  /** One sentence saying what the register is FOR. Worth writing. */
  description?: string
  /** The register name in /api/governance/<register>. */
  register: string
  columns: ColumnDef[]
  fields: FieldDef[]
  initial: Row[]
  /** Values merged into every create — a parent id, a sensible default. */
  defaults?: Row
  canEdit?: boolean
  /** Named absence, never a bare em dash at a value's own weight (§12). */
  emptyMessage: string
  addLabel?: string
  /** Rendered under the header, before the table — a count, a warning tile. */
  children?: React.ReactNode
  /** Sort applied client-side after every change, so a new row lands in place. */
  sort?: (a: Row, b: Row) => number
}

function blankForm(fields: FieldDef[], defaults?: Row): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const f of fields) {
    const preset = defaults?.[f.name]
    if (f.type === 'bool') out[f.name] = preset === true
    else if (preset !== undefined && preset !== null) out[f.name] = String(preset)
    else out[f.name] = ''
  }
  return out
}

export default function RegisterSection({
  title,
  description,
  register,
  columns,
  fields,
  initial,
  defaults,
  canEdit = false,
  emptyMessage,
  addLabel = 'Add',
  children,
  sort,
}: RegisterSectionProps) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string | boolean>>(() => blankForm(fields, defaults))
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)

  const ordered = useMemo(() => (sort ? [...rows].sort(sort) : rows), [rows, sort])

  function openAdd() {
    setEditingId(null)
    setForm(blankForm(fields, defaults))
    setAdding(true)
  }

  function openEdit(row: Row) {
    const next: Record<string, string | boolean> = {}
    for (const f of fields) {
      const v = row[f.name]
      if (f.type === 'bool') next[f.name] = v === true
      else if (f.type === 'tribool') next[f.name] = v === null || v === undefined ? '' : String(v)
      else next[f.name] = v === null || v === undefined ? '' : String(v)
    }
    setForm(next)
    setEditingId(String(row.id))
    setAdding(true)
  }

  function closeForm() {
    setAdding(false)
    setEditingId(null)
  }

  /** Only the fields currently visible are sent — a hidden conditional field must not write. */
  function visibleFields(): FieldDef[] {
    return fields.filter((f) => !f.when || f.when.equals.includes(form[f.when.field]))
  }

  async function save() {
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { ...defaults }
      for (const f of visibleFields()) {
        const value = form[f.name]
        if (f.type === 'bool') payload[f.name] = value === true
        else if (f.type === 'tribool') payload[f.name] = value === '' ? null : value === 'true'
        else payload[f.name] = value === '' ? null : value
      }

      const res = await fetch(
        editingId ? `/api/governance/${register}/${editingId}` : `/api/governance/${register}`,
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data = (await res.json().catch(() => ({}))) as { row?: Row; error?: string }
      if (!res.ok || !data.row) {
        // The server's sentence, not a status code — explainDbError() exists to
        // turn a constraint name into something a person can act on.
        toast.error(data.error ?? 'Could not save')
        return
      }
      setRows((prev) =>
        editingId ? prev.map((r) => (r.id === editingId ? data.row! : r)) : [...prev, data.row!]
      )
      toast.success(editingId ? 'Saved' : 'Recorded')
      closeForm()
    } catch {
      toast.error('Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: Row) {
    const snapshot = rows
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    try {
      const res = await fetch(`/api/governance/${register}/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setRows(snapshot)
        toast.error(data.error ?? 'Could not remove')
        return
      }
      toast.success('Removed')
    } catch {
      setRows(snapshot)
      toast.error('Could not remove')
    }
  }

  function cell(row: Row, col: ColumnDef): React.ReactNode {
    if (col.render) return col.render(row)
    const raw = row[col.name]
    switch (col.kind) {
      case 'date':
        // A named absence, never a bare em dash at a value's own weight (§12).
        return raw ? formatDate(String(raw)) : <span className="text-muted-foreground/60">not set</span>
      case 'money':
        return raw === null || raw === undefined ? (
          <span className="text-muted-foreground/60">—</span>
        ) : (
          <span className="tnum">{formatMoney(Number(raw))}</span>
        )
      case 'percent':
        return raw === null || raw === undefined ? (
          <span className="text-muted-foreground/60">—</span>
        ) : (
          <span className="tnum">{Number(raw).toFixed(2)}%</span>
        )
      case 'number':
        return raw === null || raw === undefined ? (
          <span className="text-muted-foreground/60">—</span>
        ) : (
          <span className="tnum">{String(raw)}</span>
        )
      case 'bool':
        return raw ? 'Yes' : <span className="text-muted-foreground/60">No</span>
      case 'chip':
        if (raw === null || raw === undefined || raw === '') {
          return <span className="text-muted-foreground/60">—</span>
        }
        return (
          <Chip tone={tone(col.tones?.[String(raw)] ?? 'slate')}>
            {enumLabel(String(raw), col.labels)}
          </Chip>
        )
      default:
        if (raw === null || raw === undefined || raw === '') {
          return <span className="text-muted-foreground/60">—</span>
        }
        return enumLabel(String(raw), col.labels)
    }
  }

  const shown = visibleFields()

  return (
    <Panel>
      <PanelHeader label={title} count={rows.length}>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" onClick={openAdd}>
            <Plus size={13} data-icon="inline-start" />
            {addLabel}
          </Button>
        )}
      </PanelHeader>

      {description && (
        <p className="px-4 pt-3 text-xs text-muted-foreground/90 leading-relaxed">{description}</p>
      )}

      {children}

      {adding && (
        <div className="border-b border-border bg-muted/30 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="label-caps text-muted-foreground">
              {editingId ? `Edit ${title.replace(/s$/, '').toLowerCase()}` : addLabel}
            </h3>
            <Button size="icon-xs" variant="ghost" onClick={closeForm} aria-label="Close">
              <X size={14} />
            </Button>
          </div>
          <FormGrid cols={2}>
            {shown.map((f) => (
              <Field
                key={f.name}
                label={f.label}
                hint={f.hint}
                required={f.required}
                className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined}
              >
                {f.type === 'textarea' ? (
                  <Textarea
                    value={String(form[f.name] ?? '')}
                    placeholder={f.placeholder}
                    onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  />
                ) : f.type === 'date' ? (
                  <FieldDate
                    value={String(form[f.name] ?? '')}
                    onChange={(v: string) => setForm((p) => ({ ...p, [f.name]: v }))}
                  />
                ) : f.type === 'select' ? (
                  <Select
                    value={String(form[f.name] ?? '')}
                    // Bounded: a native select sizes to its widest option, and
                    // one long entity name otherwise stretches the column to
                    // half the row and wraps everything beside it (§12).
                    className="max-w-full truncate"
                    onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  >
                    <option value="">{f.required ? 'Choose…' : '— none —'}</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.type === 'bool' ? (
                  <label className="relative flex h-11 items-center gap-2 text-sm sm:h-9">
                    <input
                      type="checkbox"
                      checked={form[f.name] === true}
                      onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.checked }))}
                      className="size-4 rounded border-input outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <span className="text-muted-foreground">{f.placeholder ?? 'Yes'}</span>
                    {/* 44px minimum target, grown with an inset overlay rather
                        than padding so the row below does not shift (§12). */}
                    <span className="absolute -inset-3" aria-hidden />
                  </label>
                ) : f.type === 'tribool' ? (
                  <Select
                    value={String(form[f.name] ?? '')}
                    onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  >
                    <option value="">Not decided</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </Select>
                ) : (
                  <Input
                    value={String(form[f.name] ?? '')}
                    placeholder={f.placeholder}
                    inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined}
                    onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </FormGrid>
          <FormActions className="mt-4">
            <Button variant="outline" size="sm" onClick={closeForm} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save' : 'Record'}
            </Button>
          </FormActions>
        </div>
      )}

      {ordered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {columns.map((c) => (
                  <th
                    key={c.name}
                    className={[
                      'px-3 py-2 font-medium',
                      c.numeric ? 'text-right' : 'text-left',
                      c.secondary ? 'hidden sm:table-cell' : '',
                    ].join(' ')}
                  >
                    {c.label}
                  </th>
                ))}
                {canEdit && <th className="w-16 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <tr key={String(row.id)} className="border-b border-border last:border-0 align-top">
                  {columns.map((c) => (
                    <td
                      key={c.name}
                      className={[
                        'px-3 py-2',
                        c.numeric ? 'text-right' : '',
                        c.primary ? 'font-medium text-foreground' : 'text-muted-foreground',
                        c.secondary ? 'hidden sm:table-cell' : '',
                      ].join(' ')}
                    >
                      {cell(row, c)}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="px-3 py-2">
                      {/* Never hover-only below `sm` — a control that appears on
                          hover does not exist on a phone (§12). */}
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => openEdit(row)}
                          aria-label="Edit"
                          className="opacity-100 sm:opacity-60 sm:focus-visible:opacity-100 sm:group-hover:opacity-100 hover:opacity-100"
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setDeleteTarget(row)}
                          aria-label="Remove"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this record?"
        description={
          'A governance record is normally closed rather than deleted — an end date keeps the history. ' +
          'Remove only an entry made in error. The deleted row is kept in the activity log either way.'
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget)
        }}
      />
    </Panel>
  )
}
