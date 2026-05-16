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
          className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="">All Brands</option>
          {brands.map(b => (
            <option key={b.id} value={b.code}>{b.code}</option>
          ))}
        </select>
        <select
          value={filterCorridor}
          onChange={e => setFilterCorridor(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="">All Corridors</option>
          {corridors.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${viewMode === 'kanban' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
          >
            Kanban
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${viewMode === 'list' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
          >
            List
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {COLUMNS.map(status => (
          <div key={status} className="bg-white rounded-lg border border-slate-200 px-4 py-3">
            <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{SITE_STATUS_LABELS[status]}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{grouped[status]?.length ?? 0}</div>
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
                <span className="text-xs text-slate-400">{grouped[status]?.length ?? 0}</span>
              </div>
              {(grouped[status] ?? []).map(site => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">#</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Site</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Location</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Corridor</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Role</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500">Components</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500">Capital (Mid)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(site => (
                <tr key={site.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{site.site_number ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/portfolio/sites/${site.id}`} className="font-medium text-slate-900 hover:text-blue-600">
                      {site.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{[site.city, site.state].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{site.corridor_name ?? '—'}</td>
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
                    ) : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{site.component_count}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600 text-xs">
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
      className="block bg-white rounded-lg border border-slate-200 p-3.5 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {site.site_number && (
            <span className="text-xs font-mono text-slate-400 uppercase">Site {site.site_number}</span>
          )}
          <h3 className="text-sm font-semibold text-slate-900 truncate leading-tight mt-0.5">{site.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{[site.city, site.state].filter(Boolean).join(', ')}</p>
        </div>
        {site.is_lead_site && (
          <span className="shrink-0 text-xs font-bold uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
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

      <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500">
        <span>{site.component_count} component{site.component_count !== 1 ? 's' : ''}</span>
        {site.total_capital_mid ? (
          <span className="font-mono">{formatValue(site.total_capital_mid)}</span>
        ) : null}
      </div>

      {site.corridor_name && (
        <div className="mt-1.5 text-xs text-slate-400 truncate">
          {site.brand_code ? `${site.brand_code} / ` : ''}{site.corridor_name}
        </div>
      )}
    </Link>
  )
}
