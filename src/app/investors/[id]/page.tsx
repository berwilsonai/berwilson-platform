import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, MessageSquare, Banknote, UserRound, StickyNote } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { formatValue, formatDate, SECTOR_LABELS } from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'
import {
  investorType,
  investorStage,
  interestLevel,
  isOffPipeline,
  instrumentLabel,
  INVESTOR_TYPE_LABELS,
  INVESTOR_TYPE_BADGE,
  INTEREST_LEVEL_LABELS,
  INTEREST_LEVEL_BADGE,
  INVESTOR_PIPELINE,
  INVESTOR_STAGE_INDEX,
  INVESTOR_STAGE_LABELS,
} from '@/lib/utils/investors'
import InvestorStageControl from '@/components/investors/InvestorStageControl'
import InvestorDeleteButton from '@/components/investors/InvestorDeleteButton'
import InvestorNotes from '@/components/investors/InvestorNotes'
import InvestmentsSection, { type InvestmentRow } from '@/components/investors/InvestmentsSection'

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

export default async function InvestorDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: investor } = await supabase
    .from('investors')
    .select('*, party:parties(id, full_name)')
    .eq('id', id)
    .single()

  if (!investor) notFound()

  const [{ data: investments }, { data: notes }, { data: members }, { data: projects }, { data: entities }] =
    await Promise.all([
      supabase
        .from('investments')
        .select('*, project:projects(id, name), spv:entities!investments_spv_entity_id_fkey(id, name)')
        .eq('investor_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('investor_notes')
        .select('*')
        .eq('investor_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('team_members')
        .select('id, name')
        .order('created_at', { ascending: true }),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('entities').select('id, name').order('name'),
    ])

  const t = investorType(investor.investor_type)
  const s = investorStage(investor.stage)
  const heat = interestLevel(investor.interest_level)
  const offPipeline = isOffPipeline(investor.stage)
  const currentIndex = INVESTOR_STAGE_INDEX[s]
  const party = investor.party as { id: string; full_name: string } | null
  const owner = (members ?? []).find((m) => m.id === investor.relationship_owner_id)

  const invRows = (investments ?? []) as unknown as InvestmentRow[]
  const sum = (key: 'amount_indicated' | 'amount_committed' | 'amount_funded') =>
    invRows.reduce((acc, i) => acc + (i[key] ?? 0), 0)
  const indicated = sum('amount_indicated')
  const committed = sum('amount_committed')
  const funded = sum('amount_funded')

  const checkRange =
    investor.check_size_min != null || investor.check_size_max != null
      ? investor.check_size_min != null && investor.check_size_max != null
        ? `${formatValue(investor.check_size_min)}–${formatValue(investor.check_size_max)}`
        : investor.check_size_min != null
          ? `${formatValue(investor.check_size_min)}+`
          : `up to ${formatValue(investor.check_size_max)}`
      : null

  const structures = (investor.preferred_structures ?? [])
    .map((v) => instrumentLabel(v))
    .filter(Boolean)
    .join(', ')
  const sectors = (investor.sector_interests ?? [])
    .map((v) => SECTOR_LABELS[v as ProjectSector] ?? v)
    .join(', ')

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/investors" className="text-muted-foreground hover:text-foreground transition-colors">
          Investors
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{investor.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', INVESTOR_TYPE_BADGE[t])}>
              {INVESTOR_TYPE_LABELS[t]}
            </span>
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', INTEREST_LEVEL_BADGE[heat])}>
              {INTEREST_LEVEL_LABELS[heat]}
            </span>
          </div>
          <h1 className="text-xl font-semibold leading-tight">{investor.name}</h1>
          {party && (
            <Link
              href={`/contacts/${party.id}`}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <UserRound size={13} />
              View directory contact
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <InvestorStageControl investorId={id} stage={s} />
          <Link
            href={`/investors/${id}/edit`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Pencil size={13} />
            Edit
          </Link>
          <InvestorDeleteButton investorId={id} name={investor.name} />
        </div>
      </div>

      {/* Pipeline progress */}
      {!offPipeline && (
        <div className="flex items-center gap-1">
          {INVESTOR_PIPELINE.map((stage, i) => (
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
                {INVESTOR_STAGE_LABELS[stage]}
              </span>
            </div>
          ))}
        </div>
      )}
      {offPipeline && (
        <div className={cn(
          'rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset',
          s === 'passed'
            ? 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30'
            : 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'
        )}>
          {INVESTOR_STAGE_LABELS[s]}
        </div>
      )}

      {/* Money band */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ['Indicated', indicated],
          ['Committed', committed],
          ['Funded', funded],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tnum mt-0.5">{value > 0 ? formatValue(value) : '—'}</p>
          </div>
        ))}
      </div>

      {/* Key facts */}
      <div className="rounded-lg border border-border bg-card p-4 elev-1">
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Fact label="Typical Check" value={checkRange && <span className="font-semibold tnum">{checkRange}</span>} />
          <Fact label="Preferred Structures" value={structures || null} />
          <Fact label="Sector Interests" value={sectors || null} />
          <Fact label="Relationship Owner" value={owner?.name} />
          <Fact label="Source" value={investor.source} />
          <Fact label="Referred By" value={investor.referred_by} />
          <Fact label="Last Contact" value={investor.last_contact_date ? formatDate(investor.last_contact_date) : null} />
          <Fact label="Next Step By" value={investor.next_step_date ? formatDate(investor.next_step_date) : null} />
        </dl>
      </div>

      {/* Next step */}
      {investor.next_step && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-[11px] uppercase tracking-wide text-primary font-semibold">Next Step</span>
          <p className="text-sm text-foreground mt-0.5">
            {investor.next_step}
            {investor.next_step_date && (
              <span className="text-muted-foreground"> — by {formatDate(investor.next_step_date)}</span>
            )}
          </p>
        </div>
      )}

      {/* Background */}
      {investor.notes && (
        <section>
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            <StickyNote size={13} /> Background
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{investor.notes}</p>
        </section>
      )}

      {/* Investments */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <Banknote size={15} /> Investments
        </h2>
        <InvestmentsSection
          investorId={id}
          investments={invRows}
          projects={projects ?? []}
          entities={entities ?? []}
        />
      </section>

      {/* Notes */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <MessageSquare size={15} /> Contact Log
        </h2>
        <InvestorNotes investorId={id} notes={notes ?? []} />
      </section>
    </div>
  )
}
