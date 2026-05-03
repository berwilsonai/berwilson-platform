'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Building2, Mail, Phone, Search, Sparkles, User, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ContactWithStats {
  id: string
  full_name: string
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  is_organization: boolean | null
  avatar_url: string | null
  project_count: number
  roles: string[]
  last_active: string | null
}

type SortKey = 'name' | 'company' | 'last_active' | 'project_count'
type ViewMode = 'all' | 'individuals' | 'organizations'

interface ContactsClientProps {
  contacts: ContactWithStats[]
}

export default function ContactsClient({ contacts }: ContactsClientProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [view, setView] = useState<ViewMode>('all')

  const filtered = useMemo(() => {
    let list = contacts

    if (view === 'individuals') list = list.filter(c => !c.is_organization)
    else if (view === 'organizations') list = list.filter(c => !!c.is_organization)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        c =>
          c.full_name.toLowerCase().includes(q) ||
          (c.company ?? '').toLowerCase().includes(q) ||
          (c.title ?? '').toLowerCase().includes(q) ||
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
  }, [contacts, search, sort, view])

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
            placeholder="Search name, company, role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 pr-8 w-60 rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-muted-foreground">
          No contacts match your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(contact => (
            <ContactCard key={contact.id} contact={contact} />
          ))}
        </div>
      )}
    </div>
  )
}

function ContactCard({ contact }: { contact: ContactWithStats }) {
  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="group block rounded-lg border border-border bg-card p-4 hover:border-foreground/20 hover:shadow-sm transition-all"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="size-9 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {contact.avatar_url ? (
            <img src={contact.avatar_url} alt={contact.full_name} className="size-9 object-cover" />
          ) : contact.is_organization ? (
            <Building2 size={16} className="text-muted-foreground" />
          ) : (
            <User size={16} className="text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight truncate">{contact.full_name}</p>
          {contact.title && (
            <p className="text-xs text-muted-foreground truncate">{contact.title}</p>
          )}
          {contact.company && (
            <p className="text-xs text-muted-foreground truncate">{contact.company}</p>
          )}
        </div>
        <span
          title="Enrich profile"
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-purple-400 hover:text-purple-600 mt-0.5"
          onClick={(e) => {
            e.preventDefault()
            window.location.href = `/contacts/${contact.id}?tab=overview`
          }}
        >
          <Sparkles size={14} />
        </span>
      </div>

      {/* Contact info */}
      {(contact.email || contact.phone) && (
        <div className="space-y-1 mb-3">
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

      {/* Footer: roles + project count */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {contact.roles.slice(0, 3).map(role => (
            <span
              key={role}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
            >
              {role}
            </span>
          ))}
          {contact.roles.length > 3 && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
              +{contact.roles.length - 3}
            </span>
          )}
        </div>
        {contact.project_count > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {contact.project_count} project{contact.project_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </Link>
  )
}
