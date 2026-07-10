import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, HandCoins } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import {
  INVESTOR_TYPES,
  INVESTOR_STAGES,
  INTEREST_LEVELS,
  raiseStatus,
  RAISE_STATUS_LABELS,
  RAISE_STATUS_BADGE,
  type InvestorType,
  type InvestorStage,
  type InterestLevel,
} from '@/lib/utils/investors'
import { parseTranches, raiseLevels, fillTranches } from '@/lib/investors/raises'
import EmptyState from '@/components/shared/EmptyState'
import InvestorFilters from '@/components/investors/InvestorFilters'
import InvestorsClient, { type InvestorCardData } from '@/components/investors/InvestorsClient'
import RaiseTrancheBar, { TrancheBarLegend } from '@/components/investors/RaiseTrancheBar'

export const metadata = { title: 'Investors — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<{ stage?: string; type?: string; interest?: string; target?: string }>
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

export default async function InvestorsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const stage = INVESTOR_STAGES.includes(params.stage as InvestorStage) ? (params.stage as InvestorStage) : ''
  const type = INVESTOR_TYPES.includes(params.type as InvestorType) ? (params.type as InvestorType) : ''
  const interest = INTEREST_LEVELS.includes(params.interest as InterestLevel) ? (params.interest as InterestLevel) : ''
  const target = params.target === 'company' || params.target === 'project' ? params.target : ''

  const supabase = createAdminClient()

  // Small dataset — fetch everything once, filter + roll up in memory so the
  // stats band and the target filter can both use the investments join.
  const [{ data: investorRows, error }, { data: investmentRows }, { data: raiseRows }] = await Promise.all([
    supabase
      .from('investors')
      .select('*, party:parties(id, full_name, is_organization)')
      .order('updated_at', { ascending: false }),
    supabase
      .from('investments')
      .select('*, project:projects(id, name)'),
    supabase
      .from('raises')
      .select('*, project:projects(id, name)')
      .order('created_at', { ascending: true }),
  ])

  if (error) {
    throw new Error(`Failed to load investors: ${error.message}`)
  }

  const allInvestments = investmentRows ?? []
  const byInvestor = new Map<string, typeof allInvestments>()
  for (const inv of allInvestments) {
    const list = byInvestor.get(inv.investor_id) ?? []
    list.push(inv)
    byInvestor.set(inv.investor_id, list)
  }

  const filtered = (investorRows ?? []).filter((row) => {
    if (stage && row.stage !== stage) return false
    if (type && row.investor_type !== type) return false
    if (interest && row.interest_level !== interest) return false
    if (target) {
      const invs = byInvestor.get(row.id) ?? []
      if (!invs.some((i) => i.target_kind === target)) return false
    }
    return true
  })

  const items: InvestorCardData[] = filtered.map((row) => {
    const invs = byInvestor.get(row.id) ?? []
    const targets = [
      ...new Set(
        invs.map((i) =>
          i.target_kind === 'company'
            ? 'Ber Wilson (parent)'
            : (i.project as { name: string } | null)?.name ?? 'Project'
        )
      ),
    ]
    const sum = (key: 'amount_indicated' | 'amount_committed' | 'amount_funded') =>
      invs.reduce((acc, i) => acc + (i[key] ?? 0), 0)
    const party = row.party as { is_organization: boolean | null } | null
    return {
      investor: { ...row, party: undefined } as unknown as InvestorCardData['investor'],
      indicated: sum('amount_indicated'),
      committed: sum('amount_committed'),
      funded: sum('amount_funded'),
      targets,
      isOrganization: party?.is_organization ?? row.investor_type !== 'individual',
    }
  })

  // Raise rollup — over the FILTERED set so filtering to a sector of the
  // pipeline re-scopes the headline numbers too.
  const filteredIds = new Set(filtered.map((r) => r.id))
  const scoped = allInvestments.filter(
    (i) => filteredIds.has(i.investor_id) && (!target || i.target_kind === target)
  )
  const total = (key: 'amount_indicated' | 'amount_committed' | 'amount_funded', kind?: string) =>
    scoped
      .filter((i) => !kind || i.target_kind === kind)
      .reduce((acc, i) => acc + (i[key] ?? 0), 0)

  const committedCompany = total('amount_committed', 'company')
  const committedProject = total('amount_committed', 'project')

  const count = items.length
  const hasFilters = stage || type || interest || target

  // Raise dashboard cards — open/planned first, closed last
  const statusOrder: Record<string, number> = { open: 0, planned: 1, closed: 2 }
  const raises = (raiseRows ?? [])
    .slice()
    .sort((a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1))
    .map((raise) => {
      const scoped = allInvestments.filter((i) => i.raise_id === raise.id)
      const levels = raiseLevels(scoped)
      const explicit = parseTranches(raise.tranches)
      const tranches =
        explicit.length > 0
          ? explicit
          : raise.target_amount != null
            ? [{ label: 'Full raise', amount: raise.target_amount, target_date: raise.target_close_date }]
            : []
      return { raise, levels, fills: fillTranches(tranches, levels), investorCount: new Set(scoped.map((i) => i.investor_id)).size }
    })

  return (
    <div className="space-y-5">
      {/* Page toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Suspense>
            <InvestorFilters stage={stage} type={type} interest={interest} target={target} />
          </Suspense>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} investor{count !== 1 ? 's' : ''}
              {hasFilters ? ' matching' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/investors/raises/new"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Plus size={14} />
            New Raise
          </Link>
          <Link
            href="/investors/new"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            New Investor
          </Link>
        </div>
      </div>

      {/* Raises — potential vs actual per raise */}
      {raises.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Capital Raises <span className="tnum font-normal">({raises.length})</span>
            </h2>
            <TrancheBarLegend />
          </div>
          <div className={cn('grid gap-3', raises.length > 1 && 'lg:grid-cols-2')}>
            {raises.map(({ raise, levels, fills, investorCount }) => {
              const rs = raiseStatus(raise.status)
              const project = raise.project as { id: string; name: string } | null
              const targetLabel = raise.target_kind === 'company' ? 'Ber Wilson (parent)' : project?.name ?? 'Project'
              return (
                <Link
                  key={raise.id}
                  href={`/investors/raises/${raise.id}`}
                  className="block rounded-xl border border-border bg-card p-4 elev-1 lift"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold truncate">{raise.name}</span>
                        <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', RAISE_STATUS_BADGE[rs])}>
                          {RAISE_STATUS_LABELS[rs]}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{targetLabel}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tnum">{formatValue(raise.target_amount)}</p>
                      <p className="text-[11px] text-muted-foreground">target</p>
                    </div>
                  </div>
                  {fills.length > 0 && (
                    <div className="mt-3">
                      <RaiseTrancheBar tranches={fills} />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium tnum text-foreground">{formatValue(levels.committed)}</span> committed ·{' '}
                    <span className="font-medium tnum text-foreground">{formatValue(levels.funded)}</span> funded ·{' '}
                    <span className="font-medium tnum text-foreground">{formatValue(levels.potential)}</span> potential
                    {investorCount > 0 && <> · {investorCount} investor{investorCount !== 1 ? 's' : ''}</>}
                  </p>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Raise rollup */}
      {(investorRows?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Indicated" value={formatValue(total('amount_indicated'))} sub="Soft-circled interest" />
          <Stat
            label="Committed"
            value={formatValue(total('amount_committed'))}
            sub={`${formatValue(committedCompany)} parent · ${formatValue(committedProject)} projects`}
          />
          <Stat label="Funded" value={formatValue(total('amount_funded'))} sub="Wired to date" />
          <Stat label="Investors" value={String(count)} sub={hasFilters ? 'Matching filters' : 'In the pipeline'} />
        </div>
      )}

      {/* Cards grid or empty state */}
      {count === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={hasFilters ? 'No investors match these filters' : 'No investors yet'}
          description={
            hasFilters
              ? 'Try adjusting the filters above.'
              : 'Track potential investors, their interest level, and commitments to the parent company or project SPVs.'
          }
          action={
            !hasFilters ? (
              <Link
                href="/investors/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Investor
              </Link>
            ) : undefined
          }
        />
      ) : (
        <InvestorsClient items={items} />
      )}
    </div>
  )
}
