'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Building2,
  Check,
  CheckSquare,
  LayoutGrid,
  List,
  Mail,
  Phone,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { hashedAvatarClasses, nameInitials } from '@/lib/utils/avatar'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useStoredState } from '@/hooks/use-stored-state'
import { Panel } from '@/components/ui/card'
import {
  groupRoles,
  roleChipClasses,
  roleLabel,
  type ContactRoleView,
} from '@/lib/utils/contact-roles'

export interface ContactWithStats {
  id: string
  full_name: string
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  is_organization: boolean | null
  avatar_url: string | null
  tags: string[]
  relationship_notes: string | null
  project_count: number
  /** The prose on each project_players row — kept searchable, never a filter. */
  roles: string[]
  /** Registry keys for what this contact is TO US (party_roles). */
  role_keys: string[]
  last_active: string | null
}

type SortKey = 'name' | 'company' | 'last_active' | 'project_count'
type ViewMode = 'all' | 'individuals' | 'organizations'
/**
 * How many contacts fit on a screen.
 *
 * ⚠ `list` is the default, and that is a measurement rather than a taste: the
 * card grid is three across with an 80px portrait, which is six records a
 * screen against 83 contacts — and 80 of those 83 have no photograph, so the
 * photo-forward layout spends its space on an initial in a circle. The cards
 * stay for the day the directory has faces in it.
 */
type Density = 'list' | 'cards'

interface ContactsClientProps {
  contacts: ContactWithStats[]
  /** The whole registry, so a retired role still renders with its label. */
  roles: ContactRoleView[]
}

export default function ContactsClient({ contacts: initialContacts, roles }: ContactsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [contacts, setContacts] = useState(initialContacts)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [view, setView] = useState<ViewMode>('all')
  const [tagFilter, setTagFilter] = useState('')
  // Remembered per browser: a density is a per-viewer convenience, not a
  // destination — nothing needs to link to it or send it to anyone.
  const [density, setDensity] = useStoredState<Density>('contacts-density', 'list')

  // Selection / mass delete
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  function handleDelete(id: string) {
    setContacts(prev => prev.filter(c => c.id !== id))
  }

  /**
   * The role filter, in the URL.
   *
   * §12: "a filter kept only in component state is not a view — put it in the
   * URL." A directory filtered to Lenders is a thing to send somebody, and a
   * back button that does not undo a filter is a back button that lies.
   * Multi-select is OR, which is the question actually being asked — "who
   * could lend on this" is lenders OR investors, never both at once.
   */
  const roleFilter = useMemo(
    () => (searchParams.get('roles') ?? '').split(',').filter(Boolean),
    [searchParams]
  )

  const setRoleFilter = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.length > 0) params.set('roles', next.join(','))
      else params.delete('roles')
      const qs = params.toString()
      router.replace(qs ? `/contacts?${qs}` : '/contacts', { scroll: false })
    },
    [router, searchParams]
  )

  const toggleRole = useCallback(
    (key: string) => {
      setRoleFilter(roleFilter.includes(key) ? roleFilter.filter(k => k !== key) : [...roleFilter, key])
    },
    [roleFilter, setRoleFilter]
  )

  /**
   * The roles actually HELD, with counts — the filter vocabulary.
   *
   * ⚠ Derived from the rows, not from the registry (§12: "the ROWS are the
   * registry — derive the filter from the values present, and keep a curated
   * list only for what a human picks from"). The registry seeds 53 roles; a
   * filter offering 53 chips of which 34 match nobody is a wall, not a filter.
   * The full list appears only where somebody is CHOOSING a role, on a contact
   * or a project player.
   */
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    contacts.forEach(c => c.role_keys.forEach(k => counts.set(k, (counts.get(k) ?? 0) + 1)))
    const held = roles.filter(r => counts.has(r.key))
    return groupRoles(held).map(g => ({
      ...g,
      roles: g.roles.map(r => ({ ...r, count: counts.get(r.key) ?? 0 })),
    }))
  }, [contacts, roles])

  const heldRoleCount = useMemo(
    () => roleCounts.reduce((n, g) => n + g.roles.length, 0),
    [roleCounts]
  )

  // Every tag in use, with counts — the filter vocabulary
  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    contacts.forEach(c => c.tags.forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1)))
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag))
  }, [contacts])

  const filtered = useMemo(() => {
    let list = contacts

    if (view === 'individuals') list = list.filter(c => !c.is_organization)
    else if (view === 'organizations') list = list.filter(c => !!c.is_organization)

    if (tagFilter) {
      list = list.filter(c => c.tags.includes(tagFilter))
    }

    if (roleFilter.length > 0) {
      list = list.filter(c => c.role_keys.some(k => roleFilter.includes(k)))
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        c =>
          c.full_name.toLowerCase().includes(q) ||
          (c.company ?? '').toLowerCase().includes(q) ||
          (c.title ?? '').toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q) ||
          (c.relationship_notes ?? '').toLowerCase().includes(q) ||
          c.tags.some(t => t.toLowerCase().includes(q)) ||
          c.roles.some(r => r.toLowerCase().includes(q)) ||
          // The role LABEL, not the key — somebody types "lender", not
          // "senior_lender". Searching the key as well would match nothing a
          // reader has ever seen on the screen.
          c.role_keys.some(k => roleLabel(k, roles).toLowerCase().includes(q))
      )
    }

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.full_name.localeCompare(b.full_name)
        case 'company':
          return (a.company ?? '').localeCompare(b.company ?? '')
        case 'last_active':
          return (b.last_active ?? '').localeCompare(a.last_active ?? '')
        case 'project_count':
          return b.project_count - a.project_count
      }
    })
  }, [contacts, search, sort, view, tagFilter, roleFilter, roles])

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelection() {
    setSelecting(false)
    setSelected(new Set())
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(c => next.delete(c.id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(c => next.add(c.id))
        return next
      })
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    const res = await fetch('/api/parties/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      toast.error(data?.error ?? 'Failed to delete contacts')
      return
    }
    setContacts(prev => prev.filter(c => !selected.has(c.id)))
    toast.success(`${ids.length} contact${ids.length !== 1 ? 's' : ''} deleted`)
    exitSelection()
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search name, company, tag, email, notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 pr-8 w-64 rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">All Tags</option>
            {allTags.map(({ tag, count }) => (
              <option key={tag} value={tag}>
                {tag} ({count})
              </option>
            ))}
          </select>
        )}

        {/* Sort */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="name">Sort: Name</option>
          <option value="company">Sort: Company</option>
          <option value="last_active">Sort: Recently Active</option>
          <option value="project_count">Sort: Most Projects</option>
        </select>

        {/* View toggle */}
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5 text-xs">
          {(['all', 'individuals', 'organizations'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2.5 h-8 transition-colors',
                view === v
                  ? 'bg-card text-foreground font-medium elev-1'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {v === 'all' ? 'All' : v === 'individuals' ? 'People' : 'Firms'}
            </button>
          ))}
        </div>

        {/* Density. Icon-only, labelled for a screen reader — the two shapes
            are self-evident and the toolbar already wraps on a laptop. */}
        <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
          {([
            { value: 'list' as const, icon: List, label: 'Compact list' },
            { value: 'cards' as const, icon: LayoutGrid, label: 'Cards with photos' },
          ]).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setDensity(value)}
              aria-label={label}
              aria-pressed={density === value}
              title={label}
              className={cn(
                'rounded px-2.5 h-8 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                density === value
                  ? 'bg-card text-foreground font-medium elev-1'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <span className="text-xs text-muted-foreground">
          {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
        </span>

        {/* Selection controls */}
        <div className="ml-auto flex items-center gap-2">
          {selecting ? (
            <>
              <button
                onClick={toggleSelectAll}
                className="h-8 px-2.5 rounded-md border border-input text-xs text-foreground hover:bg-muted transition-colors"
              >
                {allVisibleSelected ? 'Deselect all' : `Select all (${filtered.length})`}
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={selected.size === 0}
                className="h-8 px-2.5 rounded-md bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Trash2 size={12} />
                Delete{selected.size > 0 ? ` (${selected.size})` : ''}
              </button>
              <button
                onClick={exitSelection}
                className="h-8 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setSelecting(true)}
              className="h-8 px-2.5 rounded-md border border-input text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5"
            >
              <CheckSquare size={12} />
              Select
            </button>
          )}
        </div>
      </div>

      {/* Role filter — the lookup this directory did not have.
          Grouped, because 19 flat chips is a word-search; the group heading is
          what makes "Finance & Legal" scannable at a glance. */}
      {heldRoleCount > 0 && (
        <Panel className="px-4 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="label-caps text-muted-foreground">Role</span>
            {roleFilter.length > 0 && (
              <button
                onClick={() => setRoleFilter([])}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
              >
                Clear ({roleFilter.length})
              </button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {heldRoleCount} in use
            </span>
          </div>
          {roleCounts.map(({ group, roles: groupRolesList }) => (
            <div key={group} className="flex items-baseline gap-2 flex-wrap">
              <span className="label-caps text-muted-foreground/70 w-full sm:w-44 shrink-0">
                {group}
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {groupRolesList.map(r => {
                  const on = roleFilter.includes(r.key)
                  return (
                    <button
                      key={r.key}
                      onClick={() => toggleRole(r.key)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        // ⚠ The selected state is a RING and an offset, never a
                        // second bg-* — `cn()` is tailwind-merge, so two classes
                        // in the same utility group do not compose and the later
                        // one silently deletes the earlier (§12). The tone's own
                        // background has to survive selection.
                        roleChipClasses(r.role_group),
                        on && 'ring-2 ring-offset-1 ring-offset-card font-medium'
                      )}
                    >
                      {r.label}
                      <span className="tnum opacity-60">{r.count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </Panel>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          {roleFilter.length > 0
            ? 'No contacts hold that role yet.'
            : 'No contacts match your search.'}
        </div>
      ) : density === 'list' ? (
        <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
          {filtered.map(contact => (
            <ContactRow
              key={contact.id}
              contact={contact}
              onDelete={handleDelete}
              selecting={selecting}
              selected={selected.has(contact.id)}
              onToggleSelect={toggleSelected}
              onTagClick={setTagFilter}
              roles={roles}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(contact => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onDelete={handleDelete}
              selecting={selecting}
              selected={selected.has(contact.id)}
              onToggleSelect={toggleSelected}
              onTagClick={setTagFilter}
              roles={roles}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${selected.size} contact${selected.size !== 1 ? 's' : ''}?`}
        description="They will be archived and removed from your list. Project history is preserved."
        confirmLabel="Delete"
        destructive
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}

interface ContactItemProps {
  contact: ContactWithStats
  onDelete: (id: string) => void
  selecting: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  onTagClick: (tag: string) => void
  /** The registry, for label and tone. Passed down rather than fetched. */
  roles: ContactRoleView[]
}

/**
 * The role chips on a row.
 *
 * Capped at two with a "+n", because a row is scanned and the third chip is
 * where a row starts wrapping. The full set is on the record.
 */
function RoleChips({
  keys,
  roles,
  max = 2,
}: {
  keys: string[]
  roles: ContactRoleView[]
  max?: number
}) {
  if (keys.length === 0) return null
  const resolved = keys
    .map(k => roles.find(r => r.key === k))
    .filter((r): r is ContactRoleView => !!r)
    .sort((a, b) => a.sort_order - b.sort_order)
  if (resolved.length === 0) return null
  const shown = resolved.slice(0, max)
  const extra = resolved.length - shown.length

  return (
    <span className="flex items-center gap-1 shrink-0">
      {shown.map(r => (
        <span
          key={r.key}
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 whitespace-nowrap',
            roleChipClasses(r.role_group)
          )}
        >
          {r.label}
        </span>
      ))}
      {extra > 0 && (
        <span
          className="text-xs text-muted-foreground"
          title={resolved.slice(max).map(r => r.label).join(', ')}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

/**
 * Archive one contact. ONE copy, used by both renderings — a second density is
 * not a reason for a second delete path, and the two would drift the first
 * time the endpoint or the toast changed.
 */
function useContactDelete(contact: ContactWithStats, onDelete: (id: string) => void) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/parties/${contact.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDelete(contact.id)
        toast.success(`${contact.full_name} deleted`)
        return
      }
      toast.error('Failed to delete contact')
    } catch {
      toast.error('Failed to delete contact')
    }
    setDeleting(false)
    setConfirming(false)
  }

  return { confirming, setConfirming, deleting, remove }
}

/** What a contact reads as on one line: their title and where they work. */
function secondaryLine(contact: ContactWithStats): string | null {
  const parts = [contact.title, contact.company].filter(Boolean) as string[]
  if (parts.length > 0) return parts.join(' · ')
  return contact.email ?? contact.phone ?? null
}

/**
 * The compact row — the directory's default.
 *
 * Everything the card carries that a reader SCANS by is here: the name, who
 * they are, their mailbox, how many deals they are on. What the card has and
 * this does not is the 80px portrait and the full tag list, both of which are
 * on the record itself one click away.
 */
function ContactRow({
  contact,
  onDelete,
  selecting,
  selected,
  onToggleSelect,
  onTagClick,
  roles,
}: ContactItemProps) {
  const { confirming, setConfirming, deleting, remove } = useContactDelete(contact, onDelete)
  const secondary = secondaryLine(contact)

  return (
    <div
      className={cn(
        'relative group flex items-center gap-2 pl-3 pr-1 transition-colors',
        selecting && selected ? 'bg-primary/5' : 'hover:bg-accent'
      )}
    >
      {selecting && (
        <span
          className={cn(
            'size-5 shrink-0 rounded border flex items-center justify-center',
            selected ? 'bg-primary border-primary text-primary-foreground' : 'bg-background border-input'
          )}
          aria-hidden
        >
          {selected && <Check size={13} />}
        </span>
      )}

      <Link
        href={`/contacts/${contact.id}`}
        onClick={e => {
          if (selecting) {
            e.preventDefault()
            onToggleSelect(contact.id)
          }
        }}
        aria-checked={selecting ? selected : undefined}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md"
      >
        <span
          className={cn(
            'size-9 rounded-full flex items-center justify-center shrink-0 overflow-hidden',
            contact.avatar_url
              ? 'bg-muted ring-1 ring-border'
              : contact.is_organization
                ? 'bg-primary/10 text-primary dark:bg-primary/20'
                : hashedAvatarClasses(contact.full_name)
          )}
        >
          {contact.avatar_url ? (
            <img src={contact.avatar_url} alt="" className="size-9 object-cover" />
          ) : contact.is_organization ? (
            <Building2 size={16} />
          ) : (
            <span className="text-xs font-semibold tracking-wide">{nameInitials(contact.full_name)}</span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{contact.full_name}</span>
          {secondary && (
            <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
          )}
        </span>

        {/* What they are to us. Ahead of the mailbox deliberately: this is the
            column the reader came to scan. */}
        <span className="hidden md:flex">
          <RoleChips keys={contact.role_keys} roles={roles} />
        </span>

        {/* The mailbox, where there is room for it — it is the field most often
            wanted FROM a list rather than from the record. */}
        {contact.email && (
          <span className="hidden xl:flex min-w-0 max-w-[16rem] items-center gap-1.5 text-xs text-muted-foreground">
            <Mail size={11} className="shrink-0" />
            <span className="truncate">{contact.email}</span>
          </span>
        )}

        {contact.project_count > 0 && (
          <span className="hidden sm:block shrink-0 text-xs text-muted-foreground tnum">
            {contact.project_count} project{contact.project_count !== 1 ? 's' : ''}
          </span>
        )}
      </Link>

      {/* Tags — siblings of the link, because each one is its own button. */}
      {contact.tags.length > 0 && (
        <span className="hidden md:flex shrink-0 items-center gap-1">
          {contact.tags.slice(0, 2).map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick(tag)}
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              title={`Filter by ${tag}`}
            >
              <Tag size={8} className="shrink-0" />
              {tag}
            </button>
          ))}
          {contact.tags.length > 2 && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
              +{contact.tags.length - 2}
            </span>
          )}
        </span>
      )}

      {!selecting && (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            title="Delete contact"
            aria-label={`Delete ${contact.full_name}`}
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="inline-flex items-center justify-center size-[2.75rem] sm:size-8 rounded-md text-muted-foreground transition-opacity hover:text-destructive sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </span>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${contact.full_name}?`}
        description="They will be archived and removed from your list. Project history is preserved."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  )
}

function ContactCard({
  contact,
  onDelete,
  selecting,
  selected,
  onToggleSelect,
  onTagClick,
  roles,
}: ContactItemProps) {
  const { confirming, setConfirming, deleting, remove } = useContactDelete(contact, onDelete)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    await remove()
  }

  return (
    <div className="relative group">
      {/* Confirmation overlay */}
      {confirming && (
        <div
          className="absolute inset-0 z-10 rounded-lg bg-background/97 border border-destructive/40 flex flex-col items-center justify-center gap-2 p-4"
          onClick={e => { e.preventDefault(); e.stopPropagation() }}
        >
          <p className="text-xs font-medium text-center">Delete {contact.full_name}?</p>
          <p className="text-xs text-muted-foreground text-center">
            This contact will be archived and removed from your list.
          </p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(false) }}
              className="h-7 px-3 rounded text-xs border border-input hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 px-3 rounded text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <Link
        href={`/contacts/${contact.id}`}
        onClick={e => {
          if (selecting) {
            e.preventDefault()
            onToggleSelect(contact.id)
          }
        }}
        aria-checked={selecting ? selected : undefined}
        className={cn(
          'block rounded-lg border bg-card transition-all overflow-hidden',
          selecting && selected
            ? 'border-primary ring-2 ring-primary/40'
            : 'border-border hover:border-foreground/20 hover:shadow-sm'
        )}
      >
        {/* Photo area */}
        <div className="flex flex-col items-center pt-6 pb-4 px-4 gap-3">
          <div
            className={cn(
              'size-20 rounded-full flex items-center justify-center shrink-0 overflow-hidden',
              contact.avatar_url
                ? 'bg-muted ring-2 ring-border'
                : contact.is_organization
                  ? 'bg-primary/10 text-primary dark:bg-primary/20'
                  : hashedAvatarClasses(contact.full_name)
            )}
          >
            {contact.avatar_url ? (
              <img src={contact.avatar_url} alt={contact.full_name} className="size-20 object-cover" />
            ) : contact.is_organization ? (
              <Building2 size={30} />
            ) : (
              <span className="text-xl font-semibold tracking-wide">{nameInitials(contact.full_name)}</span>
            )}
          </div>
          <div className="text-center min-w-0 w-full">
            <p className="text-sm font-semibold leading-tight truncate">{contact.full_name}</p>
            {contact.title && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.title}</p>
            )}
            {contact.company && (
              <p className="text-xs text-muted-foreground truncate">{contact.company}</p>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border mx-4" />

        {/* Contact info + footer */}
        <div className="px-4 py-3 space-y-2">
          {(contact.email || contact.phone) && (
            <div className="space-y-1">
              {contact.email && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail size={11} className="shrink-0" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone size={11} className="shrink-0" />
                  {contact.phone}
                </div>
              )}
            </div>
          )}

          {/* Roles, then tags. A card has the room for three. */}
          {contact.role_keys.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <RoleChips keys={contact.role_keys} roles={roles} max={3} />
            </div>
          )}

          {/* Tags */}
          {contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contact.tags.slice(0, 4).map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    onTagClick(tag)
                  }}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  title={`Filter by ${tag}`}
                >
                  <Tag size={8} className="shrink-0" />
                  {tag}
                </button>
              ))}
              {contact.tags.length > 4 && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                  +{contact.tags.length - 4}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1 min-w-0">
              {contact.roles.slice(0, 3).map(role => (
                <span
                  key={role}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                >
                  {role}
                </span>
              ))}
              {contact.roles.length > 3 && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                  +{contact.roles.length - 3}
                </span>
              )}
            </div>
            {contact.project_count > 0 && (
              <span className="text-xs text-muted-foreground shrink-0">
                {contact.project_count} project{contact.project_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Selection indicator */}
      {selecting && (
        <div
          className={cn(
            'absolute top-2 left-2 size-5 rounded border flex items-center justify-center pointer-events-none',
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-background border-input'
          )}
        >
          {selected && <Check size={13} />}
        </div>
      )}

      {/* Action buttons — outside the link */}
      {!selecting && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            title="Enrich profile"
            aria-label={`Enrich ${contact.full_name} profile`}
            className="sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-purple-400 hover:text-purple-600 dark:hover:text-purple-400"
            onClick={e => {
              e.preventDefault()
              window.location.href = `/contacts/${contact.id}?tab=overview`
            }}
          >
            <Sparkles size={14} />
          </button>
          <button
            title="Delete contact"
            onClick={e => { e.preventDefault(); e.stopPropagation(); setConfirming(true) }}
            className="sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
