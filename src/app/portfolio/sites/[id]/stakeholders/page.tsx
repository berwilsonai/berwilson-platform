import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { TEMPERATURE_LABELS, TEMPERATURE_BADGE, formatDate } from '@/lib/utils/constants'

export default async function StakeholdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: stakeholders },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase
      .from('stakeholder_relationships')
      .select('*, party:parties(id, full_name, company, title, email, phone)')
      .eq('site_id', id)
      .order('temperature'),
  ])

  if (!site) notFound()

  // Fetch interactions for all stakeholder relationships
  const srIds = (stakeholders ?? []).map(sr => sr.id)
  const { data: interactions } = srIds.length > 0
    ? await supabase
        .from('stakeholder_interactions')
        .select('*')
        .in('relationship_id', srIds)
        .order('interaction_date', { ascending: false })
        .limit(50)
    : { data: [] }

  const interactionsByRelationship = new Map<string, typeof interactions>()
  for (const i of interactions ?? []) {
    const existing = interactionsByRelationship.get(i.relationship_id) ?? []
    existing.push(i)
    interactionsByRelationship.set(i.relationship_id, existing)
  }

  // Temperature summary
  const tempCounts = (stakeholders ?? []).reduce((acc, sr) => {
    const t = sr.temperature ?? 'unknown'
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="mt-4 space-y-6">
      {/* Temperature summary */}
      {(stakeholders ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(tempCounts).map(([temp, count]) => (
            <span
              key={temp}
              className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TEMPERATURE_BADGE[temp as keyof typeof TEMPERATURE_BADGE] ?? 'bg-slate-50 text-slate-500 ring-slate-200'}`}
            >
              {TEMPERATURE_LABELS[temp as keyof typeof TEMPERATURE_LABELS] ?? temp}: {count}
            </span>
          ))}
        </div>
      )}

      {(stakeholders ?? []).length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">No stakeholders linked to this site yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(stakeholders ?? []).map(sr => {
            const party = sr.party as any
            const srInteractions = interactionsByRelationship.get(sr.id) ?? []
            return (
              <div key={sr.id} className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{party?.full_name ?? 'Unknown'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[party?.title, party?.company].filter(Boolean).join(' at ')}
                    </p>
                    {sr.role && (
                      <p className="text-xs text-slate-500 mt-1">{sr.role}</p>
                    )}
                  </div>
                  <span className={`shrink-0 inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${TEMPERATURE_BADGE[sr.temperature as keyof typeof TEMPERATURE_BADGE]}`}>
                    {TEMPERATURE_LABELS[sr.temperature as keyof typeof TEMPERATURE_LABELS]}
                  </span>
                </div>

                {/* Contact info */}
                {(party?.email || party?.phone) && (
                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    {party?.email && <span>{party.email}</span>}
                    {party?.phone && <span>{party.phone}</span>}
                  </div>
                )}

                {/* Recent interactions */}
                {srInteractions.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1.5">Recent Interactions</p>
                    <div className="space-y-1.5">
                      {srInteractions.slice(0, 3).map(i => (
                        <div key={i.id} className="flex items-start gap-2 text-xs">
                          <span className="text-slate-400 shrink-0 w-16">{formatDate(i.interaction_date)}</span>
                          <span className="text-slate-400 shrink-0 capitalize">{i.medium}</span>
                          <span className="text-slate-600 truncate">{i.summary}</span>
                        </div>
                      ))}
                      {srInteractions.length > 3 && (
                        <p className="text-[10px] text-slate-400">+ {srInteractions.length - 3} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
