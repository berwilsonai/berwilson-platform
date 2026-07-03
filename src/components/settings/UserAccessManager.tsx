'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Mail, Plus, ShieldCheck, UserCheck, UserX, X } from 'lucide-react'
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from '@/lib/auth/permissions'

interface Grant {
  resource_type: string
  resource_id: string
}

interface Member {
  id: string
  name: string
  email: string | null
  role: string
  active: boolean
  auth_user_id: string | null
  color: string | null
  grants: Grant[]
}

interface Option {
  id: string
  name: string
  parent_project_id?: string | null
}

interface Directory {
  members: Member[]
  projects: Option[]
  opportunities: Option[]
}

export default function UserAccessManager() {
  const [data, setData] = useState<Directory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users')
      const json = await res.json()
      if (!res.ok) {
        setLoadError(json.error ?? 'Failed to load users')
        return
      }
      setLoadError(null)
      setData(json)
    } catch {
      setLoadError('Failed to load users')
    }
  }, [])

  useEffect(() => {
    // Deferred so all setState happens after the fetch resolves, never in the effect body.
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  if (loadError) {
    return (
      <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-5 text-sm text-amber-900 dark:text-amber-200">
        {loadError}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading users…
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Users & Access</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Invite teammates and control what they can see. Roles set the sections; grants pick the
            projects &amp; opportunities for project managers.
          </p>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={14} />
          Invite User
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ROLES.map((r) => (
          <div key={r} className="rounded-md border border-border bg-card px-3 py-2">
            <p className="text-xs font-semibold">{ROLE_LABELS[r]}</p>
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {data.members.map((m) => (
          <MemberCard key={m.id} member={m} directory={data} onChanged={load} />
        ))}
      </div>

      {inviteOpen && (
        <InviteModal
          directory={data}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInviteOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function grantLabel(g: Grant, directory: Directory): string {
  const pool = g.resource_type === 'project' ? directory.projects : directory.opportunities
  return pool.find((o) => o.id === g.resource_id)?.name ?? 'Unknown'
}

function MemberCard({
  member,
  directory,
  onChanged,
}: {
  member: Member
  directory: Directory
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [editingGrants, setEditingGrants] = useState(false)

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Update failed')
        return
      }
      toast.success(successMsg)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`rounded-lg border border-border bg-card p-4 space-y-3 ${member.active ? '' : 'opacity-60'}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
            {member.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{member.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {member.email ?? 'No email'}
              {!member.auth_user_id && ' · not invited yet'}
            </p>
          </div>
          {member.auth_user_id ? (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <UserCheck size={11} /> Can sign in
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
              <UserX size={11} /> No login
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select
            value={member.role}
            disabled={saving}
            onChange={(e) => patch({ role: e.target.value }, `${member.name} is now ${ROLE_LABELS[e.target.value as Role]}`)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            disabled={saving}
            onClick={() => patch({ active: !member.active }, member.active ? `${member.name} deactivated` : `${member.name} reactivated`)}
            className="h-8 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            {member.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>

      {member.role === 'project_manager' && (
        <div className="pl-11 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck size={13} className="text-muted-foreground shrink-0" />
            {member.grants.length === 0 ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                No grants — this user can&apos;t see any projects yet.
              </span>
            ) : (
              member.grants.map((g) => (
                <span
                  key={`${g.resource_type}:${g.resource_id}`}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground"
                >
                  {grantLabel(g, directory)}
                </span>
              ))
            )}
            <button
              onClick={() => setEditingGrants(true)}
              className="text-xs text-primary hover:underline"
            >
              Edit access
            </button>
          </div>
        </div>
      )}

      {editingGrants && (
        <GrantsModal
          title={`Access for ${member.name}`}
          directory={directory}
          initial={member.grants}
          onClose={() => setEditingGrants(false)}
          onSave={async (grants) => {
            await patch({ grants }, 'Access updated')
            setEditingGrants(false)
          }}
        />
      )}
    </div>
  )
}

function GrantsPicker({
  directory,
  selected,
  onToggle,
}: {
  directory: Directory
  selected: Grant[]
  onToggle: (g: Grant) => void
}) {
  const has = (type: string, id: string) =>
    selected.some((g) => g.resource_type === type && g.resource_id === id)

  return (
    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Projects</p>
        <div className="space-y-1">
          {directory.projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={has('project', p.id)}
                onChange={() => onToggle({ resource_type: 'project', resource_id: p.id })}
                className="rounded border-input"
              />
              <span className={p.parent_project_id ? 'pl-4 text-muted-foreground' : ''}>{p.name}</span>
              {!p.parent_project_id && (
                <span className="text-[10px] text-muted-foreground">(includes sub-projects)</span>
              )}
            </label>
          ))}
          {directory.projects.length === 0 && <p className="text-xs text-muted-foreground">No projects.</p>}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Opportunities</p>
        <div className="space-y-1">
          {directory.opportunities.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={has('opportunity', o.id)}
                onChange={() => onToggle({ resource_type: 'opportunity', resource_id: o.id })}
                className="rounded border-input"
              />
              {o.name}
            </label>
          ))}
          {directory.opportunities.length === 0 && (
            <p className="text-xs text-muted-foreground">No open opportunities.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function GrantsModal({
  title,
  directory,
  initial,
  onClose,
  onSave,
}: {
  title: string
  directory: Directory
  initial: Grant[]
  onClose: () => void
  onSave: (grants: Grant[]) => Promise<void>
}) {
  const [selected, setSelected] = useState<Grant[]>(initial)
  const [saving, setSaving] = useState(false)

  const toggle = (g: Grant) =>
    setSelected((prev) =>
      prev.some((x) => x.resource_type === g.resource_type && x.resource_id === g.resource_id)
        ? prev.filter((x) => !(x.resource_type === g.resource_type && x.resource_id === g.resource_id))
        : [...prev, g]
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground">
            <X size={15} />
          </button>
        </div>
        <GrantsPicker directory={directory} selected={selected} onToggle={toggle} />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave(selected)
              } finally {
                setSaving(false)
              }
            }}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Access'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InviteModal({
  directory,
  onClose,
  onInvited,
}: {
  directory: Directory
  onClose: () => void
  onInvited: () => void
}) {
  const unlinked = directory.members.filter((m) => !m.auth_user_id && m.active)
  const [memberId, setMemberId] = useState<string>('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [grants, setGrants] = useState<Grant[]>([])
  const [sending, setSending] = useState(false)

  const toggle = (g: Grant) =>
    setGrants((prev) =>
      prev.some((x) => x.resource_type === g.resource_type && x.resource_id === g.resource_id)
        ? prev.filter((x) => !(x.resource_type === g.resource_type && x.resource_id === g.resource_id))
        : [...prev, g]
    )

  async function submit() {
    if (!email.trim()) {
      toast.error('Email is required')
      return
    }
    if (!memberId && !name.trim()) {
      toast.error('Name is required for a new member')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_member_id: memberId || undefined,
          name: name.trim() || undefined,
          email: email.trim(),
          role,
          grants: role === 'project_manager' ? grants : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Invite failed')
        return
      }
      toast.success(`Invite sent to ${email.trim()}`)
      onInvited()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Mail size={14} /> Invite User
          </h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground">
            <X size={15} />
          </button>
        </div>

        {unlinked.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Existing team member</label>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">New person…</option>
              {unlinked.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {!memberId && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
        </div>

        {role === 'project_manager' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Project & opportunity access</label>
            <div className="rounded-md border border-border p-3">
              <GrantsPicker directory={directory} selected={grants} onToggle={toggle} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={sending}
            onClick={submit}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  )
}
