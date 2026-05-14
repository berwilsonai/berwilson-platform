import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { COMPONENT_TYPE_LABELS, COMPONENT_TYPE_BADGE, COMPONENT_STATUS_LABELS, COMPONENT_STATUS_BADGE, formatValue } from '@/lib/utils/constants'

export default async function ComponentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: components },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase.from('components').select('*').eq('site_id', id).order('phase').order('created_at'),
  ])

  if (!site) notFound()

  const totalMid = (components ?? []).reduce((sum, c) => sum + Number(c.capital_mid ?? 0), 0)
  const totalLow = (components ?? []).reduce((sum, c) => sum + Number(c.capital_low ?? 0), 0)
  const totalHigh = (components ?? []).reduce((sum, c) => sum + Number(c.capital_high ?? 0), 0)

  return (
    <div className="mt-4 space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-slate-500">{(components ?? []).length} component{(components ?? []).length !== 1 ? 's' : ''}</span>
        {totalMid > 0 && (
          <>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">Capital range: <span className="font-mono font-medium text-slate-900">{formatValue(totalLow > 0 ? totalLow : totalMid * 0.8)} – {formatValue(totalHigh > 0 ? totalHigh : totalMid * 1.3)}</span></span>
          </>
        )}
      </div>

      {(components ?? []).length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">No components have been added to this site yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Phase</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500">Capital (Low)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500">Capital (Mid)</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-500">Capital (High)</th>
              </tr>
            </thead>
            <tbody>
              {(components ?? []).map(c => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${COMPONENT_TYPE_BADGE[c.type as keyof typeof COMPONENT_TYPE_BADGE]}`}>
                      {COMPONENT_TYPE_LABELS[c.type as keyof typeof COMPONENT_TYPE_LABELS]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.phase ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${COMPONENT_STATUS_BADGE[c.status as keyof typeof COMPONENT_STATUS_BADGE]}`}>
                      {COMPONENT_STATUS_LABELS[c.status as keyof typeof COMPONENT_STATUS_LABELS]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">{c.capital_low ? formatValue(Number(c.capital_low)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 font-medium">{c.capital_mid ? formatValue(Number(c.capital_mid)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500">{c.capital_high ? formatValue(Number(c.capital_high)) : '—'}</td>
                </tr>
              ))}
            </tbody>
            {totalMid > 0 && (
              <tfoot>
                <tr className="bg-slate-50 font-medium">
                  <td colSpan={4} className="px-4 py-2.5 text-slate-700 text-xs uppercase tracking-wider">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700">{totalLow > 0 ? formatValue(totalLow) : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-900 font-bold">{formatValue(totalMid)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700">{totalHigh > 0 ? formatValue(totalHigh) : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
