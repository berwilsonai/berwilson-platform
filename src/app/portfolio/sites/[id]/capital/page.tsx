import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { FUNDING_CATEGORY_LABELS, FUNDING_CATEGORY_BADGE, FUNDING_STATUS_LABELS, COMPONENT_TYPE_LABELS, formatValue } from '@/lib/utils/constants'

export default async function CapitalStackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: components },
    { data: funding },
    { data: revenueShare },
  ] = await Promise.all([
    supabase.from('sites').select('id, name').eq('id', id).single(),
    supabase.from('components').select('id, name, type, capital_low, capital_mid, capital_high').eq('site_id', id).order('phase'),
    supabase.from('funding_sources').select('*').eq('site_id', id).order('created_at'),
    supabase.from('revenue_share_agreements').select('*').eq('site_id', id).maybeSingle(),
  ])

  if (!site) notFound()

  const totalCapitalMid = (components ?? []).reduce((sum, c) => sum + Number(c.capital_mid ?? 0), 0)
  const totalCapitalHigh = (components ?? []).reduce((sum, c) => sum + Number(c.capital_high ?? 0), 0)
  const totalFunded = (funding ?? []).reduce((sum, f) => sum + Number(f.amount ?? 0), 0)
  const gap = totalCapitalMid - totalFunded

  // Check 16% concentration rule
  const concentrationWarnings = (funding ?? []).filter(f => {
    if (!f.amount || totalCapitalMid === 0) return false
    return (Number(f.amount) / totalCapitalMid) > 0.16
  })

  return (
    <div className="mt-4 space-y-6">
      {/* Capital overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Total Capital (Mid)</p>
          <p className="text-xl font-bold text-slate-900 font-mono mt-1">{formatValue(totalCapitalMid)}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">+30% Contingency</p>
          <p className="text-xl font-bold text-slate-900 font-mono mt-1">{formatValue(totalCapitalHigh > 0 ? totalCapitalHigh : totalCapitalMid * 1.3)}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Funded / Identified</p>
          <p className="text-xl font-bold text-emerald-700 font-mono mt-1">{formatValue(totalFunded)}</p>
        </div>
        <div className={`bg-white rounded-lg border px-4 py-3 ${gap > 0 ? 'border-amber-200' : 'border-slate-200'}`}>
          <p className="text-xs text-slate-500">Gap</p>
          <p className={`text-xl font-bold font-mono mt-1 ${gap > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
            {gap > 0 ? formatValue(gap) : 'Fully funded'}
          </p>
        </div>
      </div>

      {/* 16% concentration warnings */}
      {concentrationWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Concentration Warning</p>
          <p className="text-xs text-amber-700 mt-1">
            {concentrationWarnings.length} funding source{concentrationWarnings.length !== 1 ? 's' : ''} exceed{concentrationWarnings.length === 1 ? 's' : ''} the 16% single-source concentration threshold:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {concentrationWarnings.map(f => (
              <li key={f.id} className="text-xs text-amber-700">
                {f.source_name} — {formatValue(Number(f.amount))} ({((Number(f.amount) / totalCapitalMid) * 100).toFixed(1)}%)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Components capital breakdown */}
      {(components ?? []).length > 0 && (
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Capital by Component</h2>
          <div className="space-y-2">
            {(components ?? []).map(c => {
              const mid = Number(c.capital_mid ?? 0)
              const pct = totalCapitalMid > 0 ? (mid / totalCapitalMid) * 100 : 0
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 text-xs text-slate-700 truncate">{c.name}</div>
                  <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-20 text-right text-xs font-mono text-slate-600 shrink-0">{formatValue(mid)}</div>
                  <div className="w-12 text-right text-[10px] text-slate-400 shrink-0">{pct.toFixed(1)}%</div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Funding sources table */}
      <section className="bg-white rounded-lg border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Funding Sources ({(funding ?? []).length})
        </h2>
        {(funding ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No funding sources identified yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Source</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Category</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500 text-xs">Amount</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500 text-xs">% of Capital</th>
                </tr>
              </thead>
              <tbody>
                {(funding ?? []).map(f => {
                  const pct = totalCapitalMid > 0 && f.amount ? ((Number(f.amount) / totalCapitalMid) * 100) : 0
                  const overConcentration = pct > 16
                  return (
                    <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">{f.source_name}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${FUNDING_CATEGORY_BADGE[f.category as keyof typeof FUNDING_CATEGORY_BADGE]}`}>
                          {FUNDING_CATEGORY_LABELS[f.category as keyof typeof FUNDING_CATEGORY_LABELS]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {FUNDING_STATUS_LABELS[f.status as keyof typeof FUNDING_STATUS_LABELS] ?? f.status}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{f.amount ? formatValue(Number(f.amount)) : '—'}</td>
                      <td className={`px-3 py-2 text-right text-xs ${overConcentration ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
                        {pct > 0 ? `${pct.toFixed(1)}%` : '—'}
                        {overConcentration && ' !'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {totalFunded > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-medium">
                    <td colSpan={3} className="px-3 py-2 text-xs text-slate-700 uppercase tracking-wider">Total Identified</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 font-bold">{formatValue(totalFunded)}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">
                      {totalCapitalMid > 0 ? `${((totalFunded / totalCapitalMid) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      {/* Revenue share */}
      {revenueShare && (
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Revenue Share Agreement</h2>
          <div className="flex items-center gap-4 mb-2">
            <div className="flex-1">
              <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex">
                <div className="h-full bg-blue-600 rounded-l-full" style={{ width: `${revenueShare.city_pct ?? 60}%` }} />
                <div className="h-full bg-emerald-500 rounded-r-full" style={{ width: `${revenueShare.bw_pct ?? 40}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-xs">
                <span className="text-blue-600 font-medium">City {revenueShare.city_pct}%</span>
                <span className="text-emerald-600 font-medium">BW {revenueShare.bw_pct}%</span>
              </div>
            </div>
          </div>
          {revenueShare.revenue_base && (
            <p className="text-xs text-slate-500 mt-3 border-t border-slate-100 pt-3">{revenueShare.revenue_base}</p>
          )}
          {revenueShare.notes && (
            <p className="text-xs text-slate-500 mt-2">{revenueShare.notes}</p>
          )}
        </section>
      )}
    </div>
  )
}
