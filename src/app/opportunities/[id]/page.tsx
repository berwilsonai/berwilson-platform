import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, Target, Lightbulb, FileText, MessageSquare, ExternalLink, ListChecks } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { formatValue, formatDate, SECTOR_LABELS } from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'
import {
  oppType,
  oppStatus,
  oppPriority,
  isClosedStatus,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_TYPE_BADGE,
  OPPORTUNITY_PRIORITY_LABELS,
  OPPORTUNITY_PRIORITY_BADGE,
  OPPORTUNITY_PIPELINE,
  OPPORTUNITY_STATUS_INDEX,
  OPPORTUNITY_STATUS_LABELS,
} from '@/lib/utils/opportunities'
import OpportunityStatusControl from '@/components/opportunities/OpportunityStatusControl'
import OpportunityDeleteButton from '@/components/opportunities/OpportunityDeleteButton'
import OpportunityDocuments from '@/components/opportunities/OpportunityDocuments'
import OpportunityNotes from '@/components/opportunities/OpportunityNotes'
import OpportunityTasks from '@/components/opportunities/OpportunityTasks'

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

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .single()

  if (!opportunity) notFound()

  const [{ data: documents }, { data: notes }, { data: tasks }, { data: members }] = await Promise.all([
    supabase
      .from('opportunity_documents')
      .select('*')
      .eq('opportunity_id', id)
      .order('uploaded_at', { ascending: false }),
    supabase
      .from('opportunity_notes')
      .select('*')
      .eq('opportunity_id', id)
      .order('created_at', { ascending: false }),
    // Tolerant of the opportunity_id column not existing yet (returns null → [] until the migration lands).
    supabase
      .from('tasks')
      .select('*, assignee:team_members(id, name, color), project:projects(id, name)')
      .eq('opportunity_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('team_members')
      .select('id, name, color')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  const t = oppType(opportunity.opp_type)
  const s = oppStatus(opportunity.status)
  const p = oppPriority(opportunity.priority)
  const closed = isClosedStatus(opportunity.status)
  const onHold = s === 'on_hold'
  const currentIndex = OPPORTUNITY_STATUS_INDEX[s]

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/opportunities" className="text-muted-foreground hover:text-foreground transition-colors">
          Opportunities
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{opportunity.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', OPPORTUNITY_TYPE_BADGE[t])}>
              {OPPORTUNITY_TYPE_LABELS[t]}
            </span>
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', OPPORTUNITY_PRIORITY_BADGE[p])}>
              {OPPORTUNITY_PRIORITY_LABELS[p]} priority
            </span>
          </div>
          <h1 className="text-xl font-semibold leading-tight">{opportunity.name}</h1>
          {opportunity.target_name && (
            <p className="text-sm text-muted-foreground">{opportunity.target_name}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <OpportunityStatusControl opportunityId={id} status={s} />
          <Link
            href={`/opportunities/${id}/edit`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Pencil size={13} />
            Edit
          </Link>
          <OpportunityDeleteButton opportunityId={id} name={opportunity.name} />
        </div>
      </div>

      {/* Pipeline progress */}
      {!closed && !onHold && (
        <div className="flex items-center gap-1">
          {OPPORTUNITY_PIPELINE.map((stage, i) => (
            <div key={stage} className="flex-1 min-w-0">
              <div
                className={cn(
                  'h-1.5 rounded-full transition-colors',
                  i <= currentIndex ? 'bg-primary' : 'bg-muted'
                )}
              />
              <span
                className={cn(
                  'mt-1 block text-[10px] truncate',
                  i === currentIndex ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}
              >
                {OPPORTUNITY_STATUS_LABELS[stage]}
              </span>
            </div>
          ))}
        </div>
      )}
      {onHold && (
        <div className="rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
          On Hold
        </div>
      )}
      {closed && (
        <div className={cn(
          'rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset',
          opportunity.status === 'closed_won'
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30'
            : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30'
        )}>
          {OPPORTUNITY_STATUS_LABELS[s]}
        </div>
      )}

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
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Overview</h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{opportunity.description}</p>
        </section>
      )}

      {/* Objective + Thesis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-lg border border-border bg-card p-4 elev-1">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            <Target size={13} /> Objective
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {opportunity.objective || <span className="text-muted-foreground">Not set yet.</span>}
          </p>
        </section>
        <section className="rounded-lg border border-border bg-card p-4 elev-1">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
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

      {/* Tasks */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <ListChecks size={15} /> Tasks
        </h2>
        <OpportunityTasks
          opportunityId={id}
          initialTasks={(tasks ?? []) as unknown as BoardTask[]}
          teamMembers={(members ?? []) as TeamMember[]}
        />
      </section>

      {/* Documents */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <FileText size={15} /> White Papers & Documents
        </h2>
        <OpportunityDocuments opportunityId={id} documents={documents ?? []} />
      </section>

      {/* Notes */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <MessageSquare size={15} /> Progress Notes
        </h2>
        <OpportunityNotes opportunityId={id} notes={notes ?? []} />
      </section>
    </div>
  )
}
