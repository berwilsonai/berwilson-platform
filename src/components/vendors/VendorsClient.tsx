'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Building2, Check, CheckSquare, HardHat, Handshake, MapPin, Search, Star, Tag, Trash2, Truck, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ENTITY_CATEGORY_LABELS,
  ENTITY_CATEGORY_BADGE,
  type EntityCategory,
} from '@/lib/utils/constants'

export interface VendorWithStats {
  id: string
  name: string
  entity_type: string
  category: EntityCategory
  jurisdiction: string | null
  website_url: string | null
  description: string | null
  specialties: string[]
  quality_score: number | null
  confidence_score: number | null
  headquarters: string | null
  logo_url: string | null
  enriched_at: string | null
  project_count: number
  relationships: string[]
}

type SortKey = 'name' | 'quality_score' | 'project_count'
type CategoryTab = 'all' | EntityCategory

interface VendorsClientProps {
  vendors: VendorWithStats[]
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  vendor: 'Vendor',
  subcontractor: 'Subcontractor',
  consultant: 'Consultant',
  partner: 'Partner',
  owner: 'Owner',
  jv_partner: 'JV Partner',
  sub_entity: 'Sub-Entity',
  guarantor: 'Guarantor',
}

const CATEGORY_ICONS: Record<EntityCategory, typeof Building2> = {
  vendor: Truck,
  partner: Handshake,
  contractor: HardHat,
}

export default function VendorsClient({ vendors: initialVendors }: VendorsClientProps) {
  const [vendors, setVendors] = useState(initialVendors)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [filterRelationship, setFilterRelationship] = useState<string>('')
  const [filterSpecialty, setFilterSpecialty] = useState<string>('')
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('all')

  // Selection / mass delete
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: vendors.length, vendor: 0, partner: 0, contractor: 0 }
    vendors.forEach(v => { counts[v.category] = (counts[v.category] || 0) + 1 })
    return counts
  }, [vendors])

  // Collect all unique specialties for the filter dropdown
  const allSpecialties = useMemo(() => {
    const set = new Set<string>()
    vendors.forEach(v => v.specialties.forEach(s => set.add(s)))
    return [...set].sort()
  }, [vendors])

  // Collect all unique relationships
  const allRelationships = useMemo(() => {
    const set = new Set<string>()
    vendors.forEach(v => v.relationships.forEach(r => set.add(r)))
    return [...set].sort()
  }, [vendors])

  const filtered = useMemo(() => {
    let list = vendors

    // Category tab filter
    if (categoryTab !== 'all') {
      list = list.filter(v => v.category === categoryTab)
    }

    if (filterRelationship) {
      list = list.filter(v => v.relationships.includes(filterRelationship))
    }

    if (filterSpecialty) {
      list = list.filter(v => v.specialties.includes(filterSpecialty))
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        v =>
          v.name.toLowerCase().includes(q) ||
          (v.description ?? '').toLowerCase().includes(q) ||
          v.specialties.some(s => s.toLowerCase().includes(q)) ||
          (v.headquarters ?? '').toLowerCase().includes(q)
      )
    }

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'quality_score':
          return (b.quality_score ?? 0) - (a.quality_score ?? 0)
        case 'project_count':
          return b.project_count - a.project_count
      }
    })
  }, [vendors, search, sort, filterRelationship, filterSpecialty, categoryTab])

  const hasFilters = !!search || !!filterRelationship || !!filterSpecialty || categoryTab !== 'all'

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

  const allVisibleSelected = filtered.length > 0 && filtered.every(v => selected.has(v.id))

  function toggleSelectAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach(v => next.delete(v.id))
      else filtered.forEach(v => next.add(v.id))
      return next
    })
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    const res = await fetch('/api/entities/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      toast.error(data?.error ?? 'Failed to delete vendors')
      return
    }
    setVendors(prev => prev.filter(v => !selected.has(v.id)))
    toast.success(`${ids.length} vendor${ids.length !== 1 ? 's' : ''} deleted`)
    exitSelection()
  }

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setCategoryTab('all')}
          className={cn(
            'px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
            categoryTab === 'all'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          All ({categoryCounts.all})
        </button>
        {(['vendor', 'contractor', 'partner'] as EntityCategory[]).map(cat => {
          const Icon = CATEGORY_ICONS[cat]
          return (
            <button
              key={cat}
              onClick={() => setCategoryTab(cat)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
                categoryTab === cat
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon size={12} />
              {ENTITY_CATEGORY_LABELS[cat]}s ({categoryCounts[cat] || 0})
            </button>
          )
        })}
      </div>

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
            placeholder="Search name, specialty, location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 pr-8 w-60 rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Relationship filter */}
        {allRelationships.length > 0 && (
          <select
            value={filterRelationship}
            onChange={e => setFilterRelationship(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Roles</option>
            {allRelationships.map(r => (
              <option key={r} value={r}>{RELATIONSHIP_LABELS[r] ?? r}</option>
            ))}
          </select>
        )}

        {/* Specialty filter */}
        {allSpecialties.length > 0 && (
          <select
            value={filterSpecialty}
            onChange={e => setFilterSpecialty(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Specialties</option>
            {allSpecialties.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {/* Sort */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring ml-auto"
        >
          <option value="name">Sort: Name</option>
          <option value="quality_score">Sort: Quality Score</option>
          <option value="project_count">Sort: Projects</option>
        </select>

        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setFilterRelationship(''); setFilterSpecialty(''); setCategoryTab('all') }}
            className="h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Clear
          </button>
        )}

        {/* Selection controls */}
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

      {/* Result count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} vendor{filtered.length !== 1 ? 's' : ''}
        {hasFilters ? ` (of ${vendors.length} total)` : ''}
      </p>

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(vendor => (
          <VendorCard
            key={vendor.id}
            vendor={vendor}
            selecting={selecting}
            selected={selected.has(vendor.id)}
            onToggleSelect={toggleSelected}
          />
        ))}
      </div>

      {filtered.length === 0 && vendors.length > 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">
          No vendors match your filters.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${selected.size} vendor${selected.size !== 1 ? 's' : ''}?`}
        description="This permanently deletes the vendor records and their project links. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}

function VendorCard({
  vendor,
  selecting,
  selected,
  onToggleSelect,
}: {
  vendor: VendorWithStats
  selecting: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const displayScore = vendor.quality_score

  return (
    <Link
      href={`/vendors/${vendor.id}`}
      onClick={e => {
        if (selecting) {
          e.preventDefault()
          onToggleSelect(vendor.id)
        }
      }}
      aria-checked={selecting ? selected : undefined}
      className={cn(
        'group relative block rounded-lg border bg-card p-4 transition-all',
        selecting && selected
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-border hover:border-primary/30 hover:shadow-sm'
      )}
    >
      {/* Selection indicator */}
      {selecting && (
        <div
          className={cn(
            'absolute top-2 right-2 size-5 rounded border flex items-center justify-center pointer-events-none',
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-background border-input'
          )}
        >
          {selected && <Check size={13} />}
        </div>
      )}
      {/* Header */}
      <div className="flex items-start gap-3">
        {vendor.logo_url ? (
          <img
            src={vendor.logo_url}
            alt=""
            className="w-9 h-9 rounded object-contain bg-muted shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded bg-primary/10 text-primary dark:bg-primary/20 flex items-center justify-center shrink-0">
            <Building2 size={16} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate group-hover:text-primary transition-colors">
            {vendor.name}
          </h3>
          {vendor.headquarters && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin size={10} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{vendor.headquarters}</span>
            </div>
          )}
        </div>
        {displayScore !== null && (
          <div className="flex items-center gap-1 shrink-0">
            <Star size={12} className="text-amber-500 dark:text-amber-400 fill-amber-500" />
            <span className="text-xs font-medium">{displayScore.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Description */}
      {vendor.description && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {vendor.description}
        </p>
      )}

      {/* Specialties */}
      {vendor.specialties.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {vendor.specialties.slice(0, 4).map(s => (
            <span
              key={s}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground"
            >
              <Tag size={8} className="shrink-0" />
              {s}
            </span>
          ))}
          {vendor.specialties.length > 4 && (
            <span className="text-xs text-muted-foreground">
              +{vendor.specialties.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center gap-3 text-xs text-muted-foreground">
        <span className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
          ENTITY_CATEGORY_BADGE[vendor.category]
        )}>
          {ENTITY_CATEGORY_LABELS[vendor.category]}
        </span>
        <span>{vendor.project_count} project{vendor.project_count !== 1 ? 's' : ''}</span>
        {vendor.relationships.length > 0 && (
          <span className="ml-auto truncate max-w-[120px]">
            {vendor.relationships.map(r => RELATIONSHIP_LABELS[r] ?? r).join(', ')}
          </span>
        )}
      </div>
    </Link>
  )
}
