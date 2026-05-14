import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { COMPLIANCE_STATUS_LABELS, formatDate } from '@/lib/utils/constants'

const COMPLIANCE_STATUS_BADGE: Record<string, string> = {
  not_started: 'bg-slate-100 text-slate-600 ring-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  compliant: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  non_compliant: 'bg-red-50 text-red-600 ring-red-200',
  waived: 'bg-amber-50 text-amber-700 ring-amber-200',
}

export default async function CompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: complianceItems },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase.from('compliance_items').select('*').eq('site_id', id).order('framework').order('created_at'),
  ])

  if (!site) notFound()

  // Group by framework
  const byFramework = new Map<string, typeof complianceItems>()
  for (const ci of complianceItems ?? []) {
    const fw = ci.framework ?? 'Other'
    const existing = byFramework.get(fw) ?? []
    existing.push(ci)
    byFramework.set(fw, existing)
  }

  // Status summary
  const statusCounts = (complianceItems ?? []).reduce((acc, ci) => {
    const s = ci.status ?? 'not_started'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="mt-4 space-y-6">
      {/* Status summary */}
      {(complianceItems ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span
              key={status}
              className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${COMPLIANCE_STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}
            >
              {COMPLIANCE_STATUS_LABELS[status as keyof typeof COMPLIANCE_STATUS_LABELS] ?? status}: {count}
            </span>
          ))}
        </div>
      )}

      {(complianceItems ?? []).length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">No compliance items tracked for this site yet.</p>
        </div>
      ) : (
        Array.from(byFramework.entries()).map(([framework, items]) => (
          <section key={framework} className="bg-white rounded-lg border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">{framework}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Requirement</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Due Date</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(items ?? []).map(ci => {
                    const isOverdue = ci.due_date && ci.status !== 'compliant' && ci.status !== 'waived' && new Date(ci.due_date) < new Date()
                    return (
                      <tr key={ci.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">{ci.requirement ?? ci.framework}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${COMPLIANCE_STATUS_BADGE[ci.status as string] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                            {COMPLIANCE_STATUS_LABELS[ci.status as keyof typeof COMPLIANCE_STATUS_LABELS] ?? ci.status}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                          {ci.due_date ? formatDate(ci.due_date) : '—'}
                          {isOverdue && ' (overdue)'}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 max-w-xs truncate">{ci.notes ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
