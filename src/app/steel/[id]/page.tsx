import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MessageSquare, StickyNote, TriangleAlert, FileText } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canSeeSteelFinancials, canWorkSteel } from '@/lib/auth/viewer'
import { leadSourcesInUse } from '@/lib/steel/lead-sources'
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
import { groupServices, acceleratorMap, financialsFor } from '@/lib/steel/rollups'
import SteelStageControl from '@/components/steel/SteelStageControl'
import SteelNextStepControl from '@/components/steel/SteelNextStepControl'
import SteelDeleteButton from '@/components/steel/SteelDeleteButton'
import SteelDealNotes from '@/components/steel/SteelDealNotes'
import SteelCommissionsPanel from '@/components/steel/SteelCommissionsPanel'
import SteelDealFiles from '@/components/steel/SteelDealFiles'
import SteelEditDrawer from '@/components/steel/SteelEditDrawer'
import type { Document } from '@/lib/supabase/types'

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

  // All deals + services power the per-rep accelerator (small table). Documents
  // are the deal's attached files (plans, quotes, signed orders).
  const [
    { data: notes },
    { data: members },
    { data: allDeals },
    { data: allServices },
    { data: documents },
    { data: contacts },
    leadSources,
    viewer,
  ] = await Promise.all([
    supabase
      .from('steel_deal_notes')
      .select('*')
      .eq('deal_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('team_members').select('id, name, is_steel_rep, active').order('created_at', { ascending: true }),
    supabase.from('steel_deals').select('*'),
    supabase.from('steel_deal_services').select('*'),
    supabase
      .from('documents')
      .select('*')
      .eq('steel_deal_id', id)
      .order('uploaded_at', { ascending: false }),
    supabase
      .from('parties')
      .select('id, full_name, company, is_organization')
      .neq('status', 'archived')
      .order('full_name', { ascending: true }),
    leadSourcesInUse(supabase),
    getViewer(),
  ])

  // The marketing / referral source is a contact (party), resolved by name.
  const { data: referralParty } = deal.referral_party_id
    ? await supabase.from('parties').select('id, full_name').eq('id', deal.referral_party_id).maybeSingle()
    : { data: null }

  const rows = groupServices(allDeals ?? [], allServices ?? [])
  const accel = acceleratorMap(rows, new Date().getFullYear())
  const thisRow = rows.find((r) => r.deal.id === id) ?? { deal, lines: [] }
  const services = thisRow.lines
  const fin = financialsFor(thisRow, accel)

  const s = steelStage(deal.stage)
  const lost = isLostStage(deal.stage)
  const nextOverdue = isPastDate(deal.next_step_date) && !lost && s !== 'paid'
  const currentIndex = STEEL_STAGE_INDEX[s]
  const salesperson = (members ?? []).find((m) => m.id === deal.salesperson_id)
  const referralSourceName = referralParty?.full_name ?? null
  const canDelete = viewer?.isAdmin ?? true

  // Financials visibility: management (admin/exec) sees the whole deal; a rep
  // sees only their own cut on deals where they're the salesperson.
  const canSeeFull = canSeeSteelFinancials(viewer)
  const viewerIsSalesperson = !!viewer?.teamMemberId && viewer.teamMemberId === deal.salesperson_id
  const showFinancials = canSeeFull || viewerIsSalesperson
  const salesAccelerated = !!(deal.salesperson_id && accel.get(deal.salesperson_id))
  const canEditFiles = canSeeFull || viewerIsSalesperson
  const canWork = canWorkSteel(viewer)

  // Salesperson picker = active flagged reps, plus the deal's current salesperson
  // if they aren't flagged (a legacy assignment), so editing never drops them.
  const activeReps = (members ?? []).filter((m) => m.is_steel_rep && m.active)
  let editReps = activeReps.length > 0 ? activeReps : (members ?? []).filter((m) => m.active)
  if (deal.salesperson_id && !editReps.some((r) => r.id === deal.salesperson_id) && salesperson) {
    editReps = [salesperson, ...editReps]
  }

  // Sum of the materials-category lines (a deal can have more than one) — must
  // match how the form and the save-time floor flag compute it.
  const materialsPrice =
    (services ?? [])
      .filter((x) => x.service_type === 'materials')
      .reduce((a, x) => a + (x.price ?? 0), 0) || null
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
            href={`/steel/${id}/quote`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <FileText size={13} />
            Quote
          </Link>
          {canWork && (
            <SteelEditDrawer
              deal={deal}
              reps={editReps.map((m) => ({ id: m.id, name: m.name }))}
              contacts={contacts ?? []}
              referralSource={referralParty ?? null}
              leadSources={leadSources}
              services={services}
              canSeeFinancials={canSeeFull}
            />
          )}
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

      {/* Next step — inline editable; flows to the /steel tile cards */}
      <SteelNextStepControl
        dealId={id}
        nextStep={deal.next_step}
        nextStepDate={deal.next_step_date}
        overdue={nextOverdue}
      />

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
          <Fact label="Marketing / Referral Source" value={referralSourceName} />
          <Fact label="Buyer Segment" value={deal.icp_segment} />
          <Fact label="Buying Trigger" value={deal.buying_trigger} />
          <Fact
            label="Lead Source"
            value={[leadSourceLabel(deal.lead_source), deal.lead_source_detail].filter(Boolean).join(' — ')}
          />
          <Fact
            label="Expected Delivery"
            value={deal.expected_delivery_date ? formatDate(deal.expected_delivery_date) : null}
          />
        </dl>
      </div>

      {/* Margin & commissions — management sees the full deal; a rep sees only
          their own cut. */}
      {showFinancials && (
        <SteelCommissionsPanel
          fin={fin}
          squareFeet={deal.square_feet}
          salespersonName={salesperson?.name ?? null}
          referralSourceName={referralSourceName}
          referralType={deal.referral_fee_type}
          referralValue={deal.referral_fee_value}
          payable={isCommissionPayable(deal.stage)}
          salesPaid={deal.sales_commission_paid}
          installPaid={deal.install_fee_paid}
          referralPaid={deal.referral_fee_paid}
          salesAccelerated={salesAccelerated}
          scope={canSeeFull ? 'full' : 'self'}
        />
      )}

      {/* Deal documents — plans, engineering quotes, signed orders */}
      <section>
        <h2 className="flex items-center gap-1.5 label-caps text-muted-foreground mb-2">
          <StickyNote size={13} /> Documents
        </h2>
        <SteelDealFiles dealId={id} files={(documents as Document[]) ?? []} canEdit={canEditFiles} />
      </section>

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
