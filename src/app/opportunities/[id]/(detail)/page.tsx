import { notFound } from 'next/navigation'
import { Target, Lightbulb, ExternalLink } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canAccessOpportunity } from '@/lib/auth/viewer'
import { formatValue, formatDate, SECTOR_LABELS } from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'

interface PageProps {
  params: Promise<{ id: string }>
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '' || value === '—') return null
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5">{value}</dd>
    </div>
  )
}

export default async function OpportunityOverviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .single()

  if (!opportunity) notFound()

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, id)) notFound()

  return (
    <div className="space-y-6">
      {/* Key facts */}
      <div className="rounded-lg border border-border bg-card p-4 elev-1">
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Fact label="Estimated Value" value={<span className="font-semibold tnum">{formatValue(opportunity.estimated_value)}</span>} />
          <Fact label="Ownership Stake" value={opportunity.ownership_stake != null ? `${opportunity.ownership_stake}%` : null} />
          <Fact label="Probability" value={opportunity.probability != null ? `${opportunity.probability}%` : null} />
          <Fact label="Deal Structure" value={opportunity.deal_structure} />
          <Fact label="Counterparty" value={opportunity.counterparty} />
          <Fact label="Sector" value={opportunity.sector ? SECTOR_LABELS[opportunity.sector as ProjectSector] ?? opportunity.sector : null} />
          <Fact label="Location" value={opportunity.location} />
          <Fact label="Lead" value={opportunity.lead} />
          <Fact label="Source" value={opportunity.source} />
          <Fact label="Identified" value={opportunity.identified_date ? formatDate(opportunity.identified_date) : null} />
          <Fact label="Target Close" value={opportunity.target_close_date ? formatDate(opportunity.target_close_date) : null} />
          <Fact
            label="Website"
            value={
              opportunity.website ? (
                <a href={opportunity.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Link <ExternalLink size={11} />
                </a>
              ) : null
            }
          />
        </dl>
      </div>

      {/* Description */}
      {opportunity.description && (
        <section>
          <h2 className="label-caps text-muted-foreground mb-2">Overview</h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{opportunity.description}</p>
        </section>
      )}

      {/* Objective + Thesis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-lg border border-border bg-card p-4 elev-1">
          <h2 className="flex items-center gap-1.5 label-caps text-muted-foreground mb-2">
            <Target size={13} /> Objective
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {opportunity.objective || <span className="text-muted-foreground">Not set yet.</span>}
          </p>
        </section>
        <section className="rounded-lg border border-border bg-card p-4 elev-1">
          <h2 className="flex items-center gap-1.5 label-caps text-muted-foreground mb-2">
            <Lightbulb size={13} /> Strategic Thesis
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {opportunity.thesis || <span className="text-muted-foreground">Not set yet.</span>}
          </p>
        </section>
      </div>

      {/* Next step */}
      {opportunity.next_step && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-[11px] uppercase tracking-wide text-primary font-semibold">Next Step</span>
          <p className="text-sm text-foreground mt-0.5">{opportunity.next_step}</p>
        </div>
      )}
    </div>
  )
}
