import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, MessageSquare, StickyNote, TriangleAlert } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { cn } from '@/lib/utils'
import { formatValue, formatDate } from '@/lib/utils/constants'
import { isPastDate } from '@/lib/utils/investors'
import {
  steelStage,
  leadSourceLabel,
  leadSourceBadge,
  isLostStage,
  isCommissionPayable,
  formatSqft,
  effectiveSteelPricePerSqft,
  STEEL_PRICE_FLOOR_PER_SQFT,
  STEEL_PIPELINE,
  STEEL_STAGE_INDEX,
  STEEL_STAGE_LABELS,
} from '@/lib/utils/steel'
import SteelStageControl from '@/components/steel/SteelStageControl'
import SteelDeleteButton from '@/components/steel/SteelDeleteButton'
import SteelDealNotes from '@/components/steel/SteelDealNotes'
import SteelCommissionsPanel from '@/components/steel/SteelCommissionsPanel'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const { data } = await createAdminClient().from('steel_deals').select('name').eq('id', id).single()
  return { title: `${data?.name ?? 'Steel Deal'} — Ber Wilson Intelligence` }
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

export default async function SteelDealDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: deal } = await supabase.from('steel_deals').select('*').eq('id', id).single()
  if (!deal) notFound()

  const [{ data: notes }, { data: members }, { data: services }, viewer] = await Promise.all([
    supabase
      .from('steel_deal_notes')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('team_members')
      .select('id, name')
      .order('created_at', { ascending: true }),
    supabase.from('steel_deal_services').select('*').eq('deal_id', id),
    getViewer(),
  ])

  const s = steelStage(deal.stage)
  const lost = isLostStage(deal.stage)
  const nextOverdue = isPastDate(deal.next_step_date) && !lost && s !== 'paid'
  const currentIndex = STEEL_STAGE_INDEX[s]
  const salesperson = (members ?? []).find((m) => m.id === deal.salesperson_id)
  const referrer = (members ?? []).find((m) => m.id === deal.lead_source_id)
  const canDelete = viewer?.isAdmin ?? true
  const showFinancials = canSeeSteelFinancials(viewer)

  const materialsPrice = (services ?? []).find((x) => x.service_type === 'materials')?.price ?? null
  const effectivePpsf = effectiveSteelPricePerSqft(materialsPrice, deal.square_feet, deal.price_per_sqft)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/steel" className="text-muted-foreground hover:text-foreground transition-colors">
          Steel CRM
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{deal.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', leadSourceBadge(deal.lead_source))}>
              {leadSourceLabel(deal.lead_source)}
            </span>
            {deal.building_type && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
                {deal.building_type}
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold leading-tight">{deal.name}</h1>
          {deal.customer && <p className="text-sm text-muted-foreground">{deal.customer}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <SteelStageControl dealId={id} stage={s} />
          <Link
            href={`/steel/${id}/edit`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Pencil size={13} />
            Edit
          </Link>
          {canDelete && <SteelDeleteButton dealId={id} name={deal.name} />}
        </div>
      </div>

      {/* Pipeline progress */}
      {!lost && (
        <div className="flex items-center gap-1">
          {STEEL_PIPELINE.map((stage, i) => (
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
                {STEEL_STAGE_LABELS[stage]}
              </span>
            </div>
          ))}
        </div>
      )}
      {lost && (
        <div className="rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30">
          Lost
        </div>
      )}

      {/* Below-floor pricing — needs management approval */}
      {deal.pricing_below_floor && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Below floor — needs management approval
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300/90 mt-0.5">
              Steel is priced at{' '}
              {effectivePpsf != null ? (
                <strong className="tnum">${effectivePpsf.toFixed(2)}/SF</strong>
              ) : (
                'below the floor'
              )}
              , under the ${STEEL_PRICE_FLOOR_PER_SQFT}/SF floor.
            </p>
          </div>
        </div>
      )}

      {/* Money band */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ['Contract Value', deal.value != null ? formatValue(deal.value) : '—', 'Total'],
          ['Square Feet', formatSqft(deal.square_feet), 'Building size'],
          ['Price / SF', deal.price_per_sqft != null ? `$${deal.price_per_sqft.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—', 'Quoted rate'],
        ] as const).map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Key facts */}
      <div className="rounded-lg border border-border bg-card p-4 elev-1">
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Fact label="Customer" value={deal.customer} />
          <Fact label="Building Type" value={deal.building_type} />
          <Fact label="Salesperson" value={salesperson?.name} />
          <Fact
            label="Lead Source"
            value={[leadSourceLabel(deal.lead_source), deal.lead_source_detail].filter(Boolean).join(' — ')}
          />
          <Fact label="Referred By" value={referrer?.name} />
          <Fact
            label="Expected Delivery"
            value={deal.expected_delivery_date ? formatDate(deal.expected_delivery_date) : null}
          />
          <Fact
            label="Next Step By"
            value={
              deal.next_step_date ? (
                <span className={cn(nextOverdue && 'text-amber-600 dark:text-amber-400 font-medium')}>
                  {formatDate(deal.next_step_date)}
                  {nextOverdue && ' · overdue'}
                </span>
              ) : null
            }
          />
        </dl>
      </div>

      {/* Margin & commissions — admin/executive only */}
      {showFinancials && (
        <SteelCommissionsPanel
          services={services ?? []}
          referralType={deal.referral_fee_type}
          referralValue={deal.referral_fee_value}
          referralPaid={deal.referral_fee_paid}
          salespersonName={salesperson?.name ?? null}
          referrerName={referrer?.name ?? null}
          squareFeet={deal.square_feet}
          payable={isCommissionPayable(deal.stage)}
        />
      )}

      {/* Next step */}
      {deal.next_step && (
        <div
          className={cn(
            'rounded-lg border px-4 py-3',
            nextOverdue
              ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
              : 'border-primary/30 bg-primary/5'
          )}
        >
          <span
            className={cn(
              'text-[11px] uppercase tracking-wide font-semibold',
              nextOverdue ? 'text-amber-700 dark:text-amber-400' : 'text-primary'
            )}
          >
            Next Step{nextOverdue && ' — Overdue'}
          </span>
          <p className="text-sm text-foreground mt-0.5">
            {deal.next_step}
            {deal.next_step_date && (
              <span className={cn(nextOverdue ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                {' '}— by {formatDate(deal.next_step_date)}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Description */}
      {deal.description && (
        <section>
          <h2 className="flex items-center gap-1.5 label-caps text-muted-foreground mb-2">
            <StickyNote size={13} /> Scope & Notes
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{deal.description}</p>
        </section>
      )}

      {/* Deal log */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <MessageSquare size={15} /> Deal Log
        </h2>
        <SteelDealNotes dealId={id} notes={notes ?? []} />
      </section>
    </div>
  )
}
