'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { SiteStatus, Brand, Corridor } from '@/lib/supabase/types'
import { SITE_STATUS_LABELS, SITE_STATUS_BADGE, BW_ROLE_LABELS, BW_ROLE_BADGE, formatValue } from '@/lib/utils/constants'

type SiteSummary = {
  id: string
  name: string
  site_number: number | null
  city: string | null
  state: string | null
  status: SiteStatus
  bw_role: string | null
  is_lead_site: boolean
  anchor_partner: string | null
  component_count: number
  total_capital_mid: number | null
  corridor_name: string | null
  brand_code: string | null
}

interface PortfolioKanbanProps {
  sites: SiteSummary[]
  corridors: Pick<Corridor, 'id' | 'name'>[]
  brands: Pick<Brand, 'id' | 'code' | 'name'>[]
}

const COLUMNS: SiteStatus[] = ['lead_site', 'active', 'planning', 'evaluation']

export default function PortfolioKanban({ sites, corridors, brands }: PortfolioKanbanProps) {
  const [filterBrand, setFilterBrand] = useState<string>('')
  const [filterCorridor, setFilterCorridor] = useState<string>('')
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')

  const filtered = sites.filter(s => {
    if (filterBrand && s.brand_code !== filterBrand) return false
    if (filterCorridor && s.corridor_name !== filterCorridor) return false
    return true
  })

  const grouped = COLUMNS.reduce((acc, status) => {
    acc[status] = filtered.filter(s => s.status === status)
    return acc
  }, {} as Record<SiteStatus, SiteSummary[]>)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
          className="text-sm border border-slate-200 dark:border-slate-800/60 dark:border-border rounded-md px-3 py-1.5 bg-white dark:bg-card text-slate-700 dark:text-slate-200"
        >
          <option value="">All Brands</option>
          {brands.map(b => (
            <option key={b.id} value={b.code}>{b.code}</option>
          ))}
        </select>
        <select
          value={filterCorridor}
          onChange={e => setFilterCorridor(e.target.value)}
          className="text-sm border border-slate-200 dark:border-slate-800/60 dark:border-border rounded-md px-3 py-1.5 bg-white dark:bg-card text-slate-700 dark:text-slate-200"
        >
          <option value="">All Corridors</option>
          {corridors.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${viewMode === 'kanban' ? 'bg-slate-900 dark:bg-white/15 text-white border-slate-900 dark:border-white/20' : 'bg-white dark:bg-card text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800/60 dark:border-border'}`}
          >
            Kanban
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${viewMode === 'list' ? 'bg-slate-900 dark:bg-white/15 text-white border-slate-900 dark:border-white/20' : 'bg-white dark:bg-card text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800/60 dark:border-border'}`}
          >
            List
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {COLUMNS.map(status => (
          <div key={status} className="bg-white dark:bg-card rounded-lg border border-slate-200 dark:border-slate-800/60 dark:border-border px-4 py-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-muted-foreground font-medium uppercase tracking-wider">{SITE_STATUS_LABELS[status]}</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-200 dark:text-foreground mt-1">{grouped[status]?.length ?? 0}</div>
          </div>
        ))}
      </div>

      {viewMode === 'kanban' ? (
        /* Kanban view */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map(status => (
            <div key={status} className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${SITE_STATUS_BADGE[status]}`}>
                  {SITE_STATUS_LABELS[status]}
                </span>
                <span className="text-xs text-slate-400 dark:text-muted-foreground">{grouped[status]?.length ?? 0}</span>
              </div>
              {(grouped[status] ?? []).map(site => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <div className="bg-white dark:bg-card rounded-lg border border-slate-200 dark:border-slate-800/60 dark:border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-900/50 dark:border-border/60 bg-slate-50 dark:bg-slate-950/40 dark:bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">#</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Site</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Location</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Corridor</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Role</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Components</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500 dark:text-slate-400 dark:text-muted-foreground">Capital (Mid)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(site => (
                <tr key={site.id} className="border-b border-slate-50 dark:border-border/40 hover:bg-slate-50 dark:hover:bg-slate-950/40 dark:hover:bg-muted/50">
                  <td className="px-4 py-2.5 text-slate-400 dark:text-muted-foreground font-mono text-xs">{site.site_number ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/portfolio/sites/${site.id}`} className="font-medium text-slate-900 dark:text-slate-200 dark:text-foreground hover:text-blue-600 dark:hover:text-blue-400">
                      {site.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{[site.city, site.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 dark:text-muted-foreground text-xs">{site.corridor_name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SITE_STATUS_BADGE[site.status]}`}>
                      {SITE_STATUS_LABELS[site.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {site.bw_role ? (
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BW_ROLE_BADGE[site.bw_role as keyof typeof BW_ROLE_BADGE]}`}>
                        {BW_ROLE_LABELS[site.bw_role as keyof typeof BW_ROLE_LABELS]}
                      </span>
                    ) : <span className="text-slate-400 dark:text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-300">{site.component_count}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600 dark:text-slate-300 text-xs">
                    {site.total_capital_mid ? formatValue(site.total_capital_mid) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SiteCard({ site }: { site: SiteSummary }) {
  return (
    <Link
      href={`/portfolio/sites/${site.id}`}
      className="block bg-white dark:bg-card rounded-lg border border-slate-200 dark:border-slate-800/60 dark:border-border p-3.5 hover:border-slate-300 dark:hover:border-slate-700/60 dark:hover:border-border hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {site.site_number && (
            <span className="text-xs font-mono text-slate-400 dark:text-muted-foreground uppercase">Site {site.site_number}</span>
          )}
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200 dark:text-foreground truncate leading-tight mt-0.5">{site.name}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-muted-foreground mt-0.5">{[site.city, site.state].filter(Boolean).join(', ')}</p>
        </div>
        {site.is_lead_site && (
          <span className="shrink-0 text-xs font-bold uppercase bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">
            Lead
          </span>
        )}
      </div>

      {site.bw_role && (
        <div className="mt-2">
          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BW_ROLE_BADGE[site.bw_role as keyof typeof BW_ROLE_BADGE]}`}>
            {BW_ROLE_LABELS[site.bw_role as keyof typeof BW_ROLE_LABELS]}
          </span>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 dark:text-muted-foreground">
        <span>{site.component_count} component{site.component_count !== 1 ? 's' : ''}</span>
        {site.total_capital_mid ? (
          <span className="font-mono">{formatValue(site.total_capital_mid)}</span>
        ) : null}
      </div>

      {site.corridor_name && (
        <div className="mt-1.5 text-xs text-slate-400 dark:text-muted-foreground truncate">
          {site.brand_code ? `${site.brand_code} / ` : ''}{site.corridor_name}
        </div>
      )}
    </Link>
  )
}
