'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Building2, Globe, MapPin, Search, Star, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface VendorWithStats {
  id: string
  name: string
  entity_type: string
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
  review_count: number
  avg_rating: number | null
  relationships: string[]
}

type SortKey = 'name' | 'quality_score' | 'project_count' | 'avg_rating'

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

function ScoreDisplay({ score, label }: { score: number | null; label: string }) {
  if (score === null) return null
  return (
    <div className="flex items-center gap-1" title={`${label}: ${score.toFixed(1)}/5`}>
      <Star size={11} className="text-amber-500 fill-amber-500" />
      <span className="text-[11px] text-muted-foreground">{score.toFixed(1)}</span>
    </div>
  )
}

export default function VendorsClient({ vendors }: VendorsClientProps) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [filterRelationship, setFilterRelationship] = useState<string>('')
  const [filterSpecialty, setFilterSpecialty] = useState<string>('')

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
        case 'avg_rating':
          return (b.avg_rating ?? 0) - (a.avg_rating ?? 0)
      }
    })
  }, [vendors, search, sort, filterRelationship, filterSpecialty])

  const hasFilters = !!search || !!filterRelationship || !!filterSpecialty

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
          <option value="avg_rating">Sort: Track Record</option>
          <option value="project_count">Sort: Projects</option>
        </select>

        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setFilterRelationship(''); setFilterSpecialty('') }}
            className="h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Clear
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
          <VendorCard key={vendor.id} vendor={vendor} />
        ))}
      </div>

      {filtered.length === 0 && vendors.length > 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">
          No vendors match your filters.
        </p>
      )}
    </div>
  )
}

function VendorCard({ vendor }: { vendor: VendorWithStats }) {
  const displayScore = vendor.quality_score ?? vendor.avg_rating

  return (
    <Link
      href={`/vendors/${vendor.id}`}
      className="group block rounded-lg border border-border bg-card p-4 hover:border-primary/30 hover:shadow-sm transition-all"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        {vendor.logo_url ? (
          <img
            src={vendor.logo_url}
            alt=""
            className="w-9 h-9 rounded object-contain bg-muted shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
            <Building2 size={16} className="text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate group-hover:text-primary transition-colors">
            {vendor.name}
          </h3>
          {vendor.headquarters && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin size={10} className="text-muted-foreground shrink-0" />
              <span className="text-[11px] text-muted-foreground truncate">{vendor.headquarters}</span>
            </div>
          )}
        </div>
        {displayScore !== null && (
          <div className="flex items-center gap-1 shrink-0">
            <Star size={12} className="text-amber-500 fill-amber-500" />
            <span className="text-xs font-medium">{displayScore.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Description */}
      {vendor.description && (
        <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2">
          {vendor.description}
        </p>
      )}

      {/* Specialties */}
      {vendor.specialties.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {vendor.specialties.slice(0, 4).map(s => (
            <span
              key={s}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground"
            >
              <Tag size={8} className="shrink-0" />
              {s}
            </span>
          ))}
          {vendor.specialties.length > 4 && (
            <span className="text-[10px] text-muted-foreground">
              +{vendor.specialties.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>{vendor.project_count} project{vendor.project_count !== 1 ? 's' : ''}</span>
        {vendor.review_count > 0 && (
          <span>{vendor.review_count} review{vendor.review_count !== 1 ? 's' : ''}</span>
        )}
        {vendor.relationships.length > 0 && (
          <span className="ml-auto truncate max-w-[120px]">
            {vendor.relationships.map(r => RELATIONSHIP_LABELS[r] ?? r).join(', ')}
          </span>
        )}
      </div>
    </Link>
  )
}
