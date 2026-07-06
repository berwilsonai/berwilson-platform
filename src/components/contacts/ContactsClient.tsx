'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Building2,
  Check,
  CheckSquare,
  Mail,
  Phone,
  Search,
  Sparkles,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  roles: string[]
  last_active: string | null
}

type SortKey = 'name' | 'company' | 'last_active' | 'project_count'
type ViewMode = 'all' | 'individuals' | 'organizations'

interface ContactsClientProps {
  contacts: ContactWithStats[]
}

export default function ContactsClient({ contacts: initialContacts }: ContactsClientProps) {
  const [contacts, setContacts] = useState(initialContacts)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [view, setView] = useState<ViewMode>('all')
  const [tagFilter, setTagFilter] = useState('')

  // Selection / mass delete
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  function handleDelete(id: string) {
    setContacts(prev => prev.filter(c => c.id !== id))
  }

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
          c.roles.some(r => r.toLowerCase().includes(q))
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
  }, [contacts, search, sort, view, tagFilter])

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
            className="h-8 pl-8 pr-8 w-64 rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="name">Sort: Name</option>
          <option value="company">Sort: Company</option>
          <option value="last_active">Sort: Recently Active</option>
          <option value="project_count">Sort: Most Projects</option>
        </select>

        {/* View toggle */}
        <div className="flex rounded-md border border-input overflow-hidden text-xs">
          {(['all', 'individuals', 'organizations'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-2.5 h-8 transition-colors',
                view === v
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {v === 'all' ? 'All' : v === 'individuals' ? 'People' : 'Firms'}
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

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          No contacts match your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 stagger-children">
          {filtered.map(contact => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onDelete={handleDelete}
              selecting={selecting}
              selected={selected.has(contact.id)}
              onToggleSelect={toggleSelected}
              onTagClick={setTagFilter}
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

function ContactCard({
  contact,
  onDelete,
  selecting,
  selected,
  onToggleSelect,
  onTagClick,
}: {
  contact: ContactWithStats
  onDelete: (id: string) => void
  selecting: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  onTagClick: (tag: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(true)
    try {
      const res = await fetch(`/api/parties/${contact.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDelete(contact.id)
        toast.success(`${contact.full_name} deleted`)
      } else {
        toast.error('Failed to delete contact')
        setDeleting(false)
        setConfirming(false)
      }
    } catch {
      toast.error('Failed to delete contact')
      setDeleting(false)
      setConfirming(false)
    }
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
          <div className="size-20 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-border">
            {contact.avatar_url ? (
              <img src={contact.avatar_url} alt={contact.full_name} className="size-20 object-cover" />
            ) : contact.is_organization ? (
              <Building2 size={30} className="text-muted-foreground" />
            ) : (
              <User size={30} className="text-muted-foreground" />
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
            className="opacity-0 group-hover:opacity-100 transition-opacity text-purple-400 hover:text-purple-600 dark:hover:text-purple-400"
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
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
