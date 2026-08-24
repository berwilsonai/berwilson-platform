'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Factory, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, X } from 'lucide-react'
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from '@/lib/auth/permissions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  is_steel_rep?: boolean
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
            Add teammates and control what they can see. Add someone without a login to track their
            work first, then grant sign-in access when they&apos;re ready. Roles set the sections;
            grants pick the projects &amp; opportunities for project managers.
          </p>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={14} />
          Add User
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
        <AddUserModal
          directory={data}
          onClose={() => setInviteOpen(false)}
          onAdded={() => {
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
  const [passwordModal, setPasswordModal] = useState<'reset' | 'grant' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  async function deleteMember() {
    const res = await fetch(`/api/admin/users/${member.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? 'Delete failed')
      return
    }
    toast.success(`${member.name} deleted`)
    onChanged()
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
          {member.auth_user_id ? (
            <button
              disabled={saving}
              onClick={() => setPasswordModal('reset')}
              className="h-8 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors inline-flex items-center gap-1.5"
            >
              <KeyRound size={12} />
              Reset password
            </button>
          ) : (
            member.active && (
              <button
                disabled={saving}
                onClick={() => setPasswordModal('grant')}
                className="h-8 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors inline-flex items-center gap-1.5"
              >
                <UserPlus size={12} />
                Grant access
              </button>
            )
          )}
          <button
            disabled={saving}
            onClick={() =>
              patch(
                { is_steel_rep: !member.is_steel_rep },
                member.is_steel_rep ? `${member.name} is no longer a steel rep` : `${member.name} is now a steel rep`
              )
            }
            title="Steel sales rep — appears in the Salesperson list on steel deals"
            className={`h-8 px-2.5 rounded-md border text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
              member.is_steel_rep
                ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300'
                : 'border-input text-muted-foreground hover:bg-accent'
            }`}
          >
            <Factory size={12} />
            Steel rep
          </button>
          <button
            disabled={saving}
            onClick={() => patch({ active: !member.active }, member.active ? `${member.name} deactivated` : `${member.name} reactivated`)}
            className="h-8 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
          >
            {member.active ? 'Deactivate' : 'Reactivate'}
          </button>
          {!member.active && (
            <button
              disabled={saving}
              onClick={() => setConfirmDelete(true)}
              title="Permanently delete this user"
              className="h-8 px-2.5 rounded-md border border-input text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors inline-flex items-center gap-1.5"
            >
              <Trash2 size={12} />
              Delete
            </button>
          )}
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

      {passwordModal && (
        <PasswordModal
          member={member}
          mode={passwordModal}
          onClose={() => setPasswordModal(null)}
          onDone={onChanged}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Permanently delete ${member.name}?`}
        description="This removes the user and their sign-in login for good. Tasks, deals, and objectives they were assigned to keep their history but lose this assignee. This can't be undone."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={deleteMember}
      />

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

// Memorable Word-Word-#### passwords (~40 bits with the digits — plenty behind
// a tailnet-only login) so they survive being read over the phone.
const PASSWORD_WORDS = [
  'Granite', 'Falcon', 'Copper', 'Summit', 'Timber', 'Harbor', 'Beacon', 'Canyon',
  'Meadow', 'Anchor', 'Aspen', 'Bridge', 'Condor', 'Desert', 'Ember', 'Forge',
  'Glacier', 'Hollow', 'Juniper', 'Kestrel', 'Lantern', 'Marble', 'Nimbus', 'Onyx',
  'Prairie', 'Quarry', 'Ridge', 'Sierra', 'Thunder', 'Umber', 'Vista', 'Willow',
]

function generatePassword(): string {
  const rand = new Uint32Array(3)
  crypto.getRandomValues(rand)
  const a = PASSWORD_WORDS[rand[0] % PASSWORD_WORDS.length]
  let b = PASSWORD_WORDS[rand[1] % PASSWORD_WORDS.length]
  if (b === a) b = PASSWORD_WORDS[(rand[1] + 1) % PASSWORD_WORDS.length]
  const digits = (rand[2] % 9000) + 1000
  return `${a}-${b}-${digits}`
}

function PasswordModal({
  member,
  mode,
  onClose,
  onDone,
}: {
  member: Member
  mode: 'reset' | 'grant'
  onClose: () => void
  onDone: () => void
}) {
  const granting = mode === 'grant'
  const [email, setEmail] = useState(member.email ?? '')
  const [password, setPassword] = useState(generatePassword)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password)
      toast.success('Password copied')
    } catch {
      toast.error('Copy failed — select and copy it manually')
    }
  }

  async function save() {
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (granting && !email.trim()) {
      toast.error('An email is required to grant access')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(granting ? { password, email: email.trim() } : { password }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? (granting ? 'Grant access failed' : 'Password reset failed'))
        return
      }
      setDone(true)
      toast.success(granting ? `${member.name} can now sign in` : `Password set for ${member.name}`)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            {granting ? <UserPlus size={14} /> : <KeyRound size={14} />}
            {granting ? 'Grant access' : 'Reset password'} — {member.name}
          </h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground">
            <X size={15} />
          </button>
        </div>

        {done ? (
          <>
            <div className="rounded-md border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5 space-y-1">
              <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                <Check size={12} /> {granting ? 'Sign-in access granted' : 'New password is active'}
              </p>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                {granting ? email : member.email}
              </p>
              <p className="font-mono text-sm text-emerald-900 dark:text-emerald-200 select-all">{password}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Share the email and password with {member.name} directly — no email is sent, and the
              password won&apos;t be shown again after you close this.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={copyPassword}
                className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors inline-flex items-center gap-1.5"
              >
                <Copy size={12} /> Copy
              </button>
              <button
                onClick={onClose}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {granting
                ? `Creates a sign-in login for ${member.name} with the password below. No email is sent — copy it and share it with them directly.`
                : `Sets a new sign-in password for ${member.email ?? member.name} immediately. No email is involved — copy the password and share it with them directly.`}
            </p>
            {granting && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Email (their sign-in username)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {granting ? 'Password' : 'New password'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm font-mono"
                />
                <button
                  onClick={() => setPassword(generatePassword())}
                  title="Generate a new password"
                  className="h-9 px-2.5 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                onClick={save}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {saving ? (granting ? 'Granting…' : 'Setting…') : granting ? 'Grant Access' : 'Set Password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AddUserModal({
  directory,
  onClose,
  onAdded,
}: {
  directory: Directory
  onClose: () => void
  onAdded: () => void
}) {
  const unlinked = directory.members.filter((m) => !m.auth_user_id && m.active)
  const [memberId, setMemberId] = useState<string>('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [grants, setGrants] = useState<Grant[]>([])
  const [createLogin, setCreateLogin] = useState(false)
  const [password, setPassword] = useState(generatePassword)
  const [sending, setSending] = useState(false)
  // Set once a login was created, to show the shareable credentials.
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  const toggle = (g: Grant) =>
    setGrants((prev) =>
      prev.some((x) => x.resource_type === g.resource_type && x.resource_id === g.resource_id)
        ? prev.filter((x) => !(x.resource_type === g.resource_type && x.resource_id === g.resource_id))
        : [...prev, g]
    )

  async function copyCreds() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(`${created.email}\n${created.password}`)
      toast.success('Login copied')
    } catch {
      toast.error('Copy failed — select and copy it manually')
    }
  }

  async function submit() {
    if (!memberId && !name.trim()) {
      toast.error('Name is required for a new member')
      return
    }
    if (createLogin) {
      if (!email.trim()) {
        toast.error('An email is required to grant sign-in access')
        return
      }
      if (password.length < 8) {
        toast.error('Password must be at least 8 characters')
        return
      }
    }
    setSending(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_member_id: memberId || undefined,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          role,
          grants: role === 'project_manager' ? grants : undefined,
          create_login: createLogin,
          password: createLogin ? password : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to add user')
        return
      }
      if (createLogin) {
        // Keep the modal open on a credentials view so the password can be copied.
        setCreated({ email: email.trim(), password })
        toast.success('User added with sign-in access')
      } else {
        toast.success(`${name.trim() || 'User'} added — no login yet`)
        onAdded()
      }
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
            <UserPlus size={14} /> Add User
          </h3>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground">
            <X size={15} />
          </button>
        </div>

        {created ? (
          <>
            <div className="rounded-md border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2.5 space-y-1">
              <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                <Check size={12} /> User added — they can sign in now
              </p>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">{created.email}</p>
              <p className="font-mono text-sm text-emerald-900 dark:text-emerald-200 select-all">
                {created.password}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Share the email and password directly — no email is sent, and the password won&apos;t be
              shown again after you close this.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={copyCreds}
                className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors inline-flex items-center gap-1.5"
              >
                <Copy size={12} /> Copy
              </button>
              <button
                onClick={onAdded}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
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
              <label className="text-xs font-medium text-muted-foreground">
                Email {createLogin ? '' : '(optional)'}
              </label>
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

            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createLogin}
                  onChange={(e) => setCreateLogin(e.target.checked)}
                  className="mt-0.5 rounded border-input"
                />
                <span className="text-xs">
                  <span className="font-medium">Give sign-in access now</span>
                  <span className="block text-muted-foreground">
                    Leave off to add them for tracking only — you can grant access later. Sets a
                    password directly; no email is sent.
                  </span>
                </span>
              </label>
              {createLogin && (
                <div className="space-y-1 pl-6">
                  <label className="text-xs font-medium text-muted-foreground">Password</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-2.5 text-sm font-mono"
                    />
                    <button
                      onClick={() => setPassword(generatePassword())}
                      title="Generate a new password"
                      className="h-9 px-2.5 rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>

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
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {sending && <Loader2 size={12} className="animate-spin" />}
                {sending ? 'Adding…' : createLogin ? 'Add & Grant Access' : 'Add User'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
