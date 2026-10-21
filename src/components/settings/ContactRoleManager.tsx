'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Panel } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { groupRoles, roleChipClasses, type ContactRoleView } from '@/lib/utils/contact-roles'

export interface RoleRow extends ContactRoleView {
  id: string
  extraction_hint: string | null
}

/** How many contacts and players hold each role — what decides deletability. */
export type RoleCounts = Record<string, { contacts: number; players: number }>

interface Props {
  initial: RoleRow[]
  counts: RoleCounts
}

const BLANK = { key: '', label: '', role_group: '', extraction_hint: '' }

export default function ContactRoleManager({ initial, counts }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [confirmRow, setConfirmRow] = useState<RoleRow | null>(null)

  const groups = useMemo(() => groupRoles(rows), [rows])
  const groupNames = useMemo(
    () => [...new Set(rows.map(r => r.role_group))].sort(),
    [rows]
  )

  const totalHeld = useMemo(
    () =>
      rows.filter(r => (counts[r.key]?.contacts ?? 0) + (counts[r.key]?.players ?? 0) > 0).length,
    [rows, counts]
  )

  function startCreate() {
    setDraft(BLANK)
    setEditing(null)
    setCreating(true)
  }

  function startEdit(row: RoleRow) {
    setDraft({
      key: row.key,
      label: row.label,
      role_group: row.role_group,
      extraction_hint: row.extraction_hint ?? '',
    })
    setCreating(false)
    setEditing(row.id)
  }

  function cancel() {
    setCreating(false)
    setEditing(null)
    setDraft(BLANK)
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(
        creating ? '/api/settings/contact-roles' : `/api/settings/contact-roles/${editing}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'Could not save the role')
        return
      }
      toast.success(creating ? `"${draft.label}" added` : `"${draft.label}" saved`)
      cancel()
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: RoleRow) {
    const res = await fetch(`/api/settings/contact-roles/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !row.active }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(data?.error ?? 'Could not change the role')
      return
    }
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, active: !r.active } : r)))
    toast.success(row.active ? `"${row.label}" switched off` : `"${row.label}" switched on`)
    router.refresh()
  }

  async function remove(row: RoleRow) {
    const res = await fetch(`/api/settings/contact-roles/${row.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(data?.error ?? 'Could not delete the role')
      return
    }
    setRows(prev => prev.filter(r => r.id !== row.id))
    toast.success(`"${row.label}" deleted`)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Contact roles</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            The vocabulary behind the Directory filter, the role on a contact, and the role on a
            project player. Adding one here is all it takes — nothing needs deploying, and the
            extraction reads this list so a new role starts being recognised in correspondence.
          </p>
        </div>
        <button
          onClick={startCreate}
          className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} /> Add role
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="tnum font-medium text-foreground">{rows.length}</span> roles,{' '}
        <span className="tnum font-medium text-foreground">{totalHeld}</span> of them in use.
      </p>

      {(creating || editing) && (
        <Panel className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">{creating ? 'New role' : 'Edit role'}</h2>
            <button
              onClick={cancel}
              aria-label="Cancel"
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label" hint="What a reader sees on the chip">
              <Input
                value={draft.label}
                onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                placeholder="Insurance Broker"
              />
            </Field>
            <Field label="Group" hint="Existing groups are offered; a new name makes a new group">
              <Input
                list="role-groups"
                value={draft.role_group}
                onChange={e => setDraft(d => ({ ...d, role_group: e.target.value }))}
                placeholder="Finance & Legal"
              />
              <datalist id="role-groups">
                {groupNames.map(g => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
          </div>
          {creating && (
            <Field label="Key" hint="Lowercase and underscores. Permanent once anybody holds it.">
              <Input
                value={draft.key}
                onChange={e => setDraft(d => ({ ...d, key: e.target.value }))}
                placeholder="insurance_broker"
              />
            </Field>
          )}
          <Field
            label="Definition for the model"
            hint="Read verbatim when correspondence is categorised. One sentence saying who qualifies — and who does not."
          >
            <Textarea
              rows={2}
              value={draft.extraction_hint}
              onChange={e => setDraft(d => ({ ...d, extraction_hint: e.target.value }))}
              placeholder="Places insurance or surety. Use for bonding agents too."
            />
          </Field>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : creating ? 'Add role' : 'Save'}
            </button>
            <button
              onClick={cancel}
              className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </Panel>
      )}

      <div className="space-y-4">
        {groups.map(({ group, roles }) => (
          <section key={group}>
            <h2 className="label-caps text-muted-foreground mb-2">{group}</h2>
            <Panel className="divide-y divide-border overflow-hidden">
              {roles.map(r => {
                const row = rows.find(x => x.key === r.key)!
                const c = counts[r.key] ?? { contacts: 0, players: 0 }
                const held = c.contacts + c.players
                return (
                  <div
                    key={r.key}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5',
                      !r.active && 'opacity-55'
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 shrink-0',
                        roleChipClasses(r.role_group)
                      )}
                    >
                      {r.label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono truncate">{r.key}</span>
                    <span className="ml-auto text-xs text-muted-foreground tnum whitespace-nowrap">
                      {held === 0 ? (
                        'unused'
                      ) : (
                        <>
                          {c.contacts > 0 && `${c.contacts} contact${c.contacts === 1 ? '' : 's'}`}
                          {c.contacts > 0 && c.players > 0 && ' · '}
                          {c.players > 0 && `${c.players} on deals`}
                        </>
                      )}
                    </span>
                    <button
                      onClick={() => startEdit(row)}
                      className="h-7 px-2 rounded-md border border-input text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Edit
                    </button>
                    {!r.system && (
                      <button
                        onClick={() => toggleActive(row)}
                        className="h-7 px-2 rounded-md border border-input text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {r.active ? 'Switch off' : 'Switch on'}
                      </button>
                    )}
                    {!r.system && held === 0 && (
                      <button
                        onClick={() => setConfirmRow(row)}
                        aria-label={`Delete ${r.label}`}
                        title={`Delete ${r.label}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </Panel>
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmRow}
        onOpenChange={open => !open && setConfirmRow(null)}
        title={`Delete "${confirmRow?.label}"?`}
        description="Nobody holds this role, so nothing is lost. A role somebody holds cannot be deleted — switch it off instead."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (confirmRow) await remove(confirmRow)
          setConfirmRow(null)
        }}
      />
    </div>
  )
}
