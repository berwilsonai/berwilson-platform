import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { COMPONENT_TYPE_LABELS, COMPONENT_TYPE_BADGE, COMPONENT_STATUS_LABELS, COMPONENT_STATUS_BADGE, TEMPERATURE_LABELS, TEMPERATURE_BADGE, formatValue } from '@/lib/utils/constants'

export default async function SiteOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: components },
    { data: funding },
    { data: revenueShare },
    { data: stakeholders },
    { data: complianceItems },
  ] = await Promise.all([
    supabase.from('sites').select('*').eq('id', id).single(),
    supabase.from('components').select('*').eq('site_id', id).order('phase').order('created_at'),
    supabase.from('funding_sources').select('*').eq('site_id', id).order('created_at'),
    supabase.from('revenue_share_agreements').select('*').eq('site_id', id).maybeSingle(),
    supabase.from('stakeholder_relationships').select('*, party:parties(id, full_name, company, title)').eq('site_id', id).order('temperature').limit(10),
    supabase.from('compliance_items').select('*').eq('site_id', id).order('created_at'),
  ])

  if (!site) notFound()

  const totalCapitalMid = (components ?? []).reduce((sum, c) => sum + Number(c.capital_mid ?? 0), 0)
  const totalCapitalHigh = (components ?? []).reduce((sum, c) => sum + Number(c.capital_high ?? 0), 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
      {/* Main content — 2/3 width */}
      <div className="lg:col-span-2 space-y-6">
        {/* Key Fields */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Site Details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {site.acreage && (
              <>
                <dt className="text-slate-500">Acreage</dt>
                <dd className="font-medium text-slate-900">{Number(site.acreage).toLocaleString()} acres</dd>
              </>
            )}
            {site.military_nexus && (
              <>
                <dt className="text-slate-500">Military Nexus</dt>
                <dd className="text-slate-900">{site.military_nexus}</dd>
              </>
            )}
            {site.military_installations && (site.military_installations as string[]).length > 0 && (
              <>
                <dt className="text-slate-500">Installations</dt>
                <dd className="text-slate-900">{(site.military_installations as string[]).join(', ')}</dd>
              </>
            )}
            {site.anchor_partner && (
              <>
                <dt className="text-slate-500">Anchor Partner</dt>
                <dd className="font-medium text-slate-900">{site.anchor_partner}</dd>
              </>
            )}
            {site.stracnet_status && (
              <>
                <dt className="text-slate-500">STRACNET Status</dt>
                <dd className="text-slate-900">{site.stracnet_status}</dd>
              </>
            )}
            {site.procore_link && (
              <>
                <dt className="text-slate-500">Procore</dt>
                <dd><a href={site.procore_link} target="_blank" rel="noopener" className="text-blue-600 hover:underline">View in Procore</a></dd>
              </>
            )}
          </dl>
          {site.notes && (
            <p className="mt-4 text-sm text-slate-600 border-t border-slate-100 pt-3">{site.notes}</p>
          )}
        </section>

        {/* Components Summary */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Components ({(components ?? []).length})
            </h2>
            <Link href={`/portfolio/sites/${id}/components`} className="text-xs text-blue-600 hover:underline">
              View all &rarr;
            </Link>
          </div>
          {(components ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No components yet.</p>
          ) : (
            <div className="space-y-2">
              {(components ?? []).map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="min-w-0">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset mr-2 ${COMPONENT_TYPE_BADGE[c.type as keyof typeof COMPONENT_TYPE_BADGE]}`}>
                      {COMPONENT_TYPE_LABELS[c.type as keyof typeof COMPONENT_TYPE_LABELS]}
                    </span>
                    <span className="text-sm text-slate-900">{c.name}</span>
                    {c.phase && <span className="text-xs text-slate-400 ml-2">{c.phase}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${COMPONENT_STATUS_BADGE[c.status as keyof typeof COMPONENT_STATUS_BADGE]}`}>
                      {COMPONENT_STATUS_LABELS[c.status as keyof typeof COMPONENT_STATUS_LABELS]}
                    </span>
                    {c.capital_mid && (
                      <span className="text-xs font-mono text-slate-500">{formatValue(Number(c.capital_mid))}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Capital Stack Summary */}
        {totalCapitalMid > 0 && (
          <section className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Capital Summary</h2>
              <Link href={`/portfolio/sites/${id}/capital`} className="text-xs text-blue-600 hover:underline">
                Full capital stack &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500">Mid Estimate</p>
                <p className="text-xl font-bold text-slate-900 font-mono">{formatValue(totalCapitalMid)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">+30% Contingency View</p>
                <p className="text-xl font-bold text-slate-900 font-mono">{formatValue(totalCapitalHigh > 0 ? totalCapitalHigh : totalCapitalMid * 1.3)}</p>
              </div>
            </div>
            {(funding ?? []).length > 0 && (
              <p className="mt-3 text-xs text-slate-500">{(funding ?? []).length} funding source{(funding ?? []).length !== 1 ? 's' : ''} identified</p>
            )}
          </section>
        )}
      </div>

      {/* Sidebar — 1/3 width */}
      <div className="space-y-6">
        {/* Revenue Share */}
        {revenueShare && (
          <section className="bg-white rounded-lg border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Revenue Share</h2>
            <div className="flex items-center gap-4 mb-2">
              <div className="flex-1">
                <div className="h-3 rounded-full bg-blue-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full"
                    style={{ width: `${revenueShare.city_pct ?? 60}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">City {revenueShare.city_pct}% / BW {revenueShare.bw_pct}%</p>
              </div>
            </div>
            {revenueShare.revenue_base && (
              <p className="text-xs text-slate-500 mt-2">{revenueShare.revenue_base}</p>
            )}
          </section>
        )}

        {/* Stakeholders */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Stakeholders</h2>
            <Link href={`/portfolio/sites/${id}/stakeholders`} className="text-xs text-blue-600 hover:underline">
              View all &rarr;
            </Link>
          </div>
          {(stakeholders ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No stakeholders linked yet.</p>
          ) : (
            <div className="space-y-2">
              {(stakeholders ?? []).map(sr => {
                const party = sr.party as any
                return (
                  <div key={sr.id} className="flex items-center justify-between py-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{party?.full_name ?? 'Unknown'}</p>
                      <p className="text-xs text-slate-500 truncate">{[party?.title, party?.company].filter(Boolean).join(', ')}</p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TEMPERATURE_BADGE[sr.temperature as keyof typeof TEMPERATURE_BADGE]}`}>
                      {TEMPERATURE_LABELS[sr.temperature as keyof typeof TEMPERATURE_LABELS]}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Compliance Summary */}
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Compliance</h2>
            <Link href={`/portfolio/sites/${id}/compliance`} className="text-xs text-blue-600 hover:underline">
              View all &rarr;
            </Link>
          </div>
          {(complianceItems ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No compliance items tracked yet.</p>
          ) : (
            <div className="space-y-1.5">
              {(complianceItems ?? []).map(ci => (
                <div key={ci.id} className="flex items-center justify-between py-1">
                  <span className="text-xs text-slate-700 truncate">{ci.framework}</span>
                  <span className="text-xs text-slate-500 capitalize">{ci.status?.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
