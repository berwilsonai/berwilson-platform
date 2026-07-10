import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, HandCoins } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatValue } from '@/lib/utils/constants'
import {
  INVESTOR_TYPES,
  INVESTOR_STAGES,
  INTEREST_LEVELS,
  type InvestorType,
  type InvestorStage,
  type InterestLevel,
} from '@/lib/utils/investors'
import EmptyState from '@/components/shared/EmptyState'
import InvestorFilters from '@/components/investors/InvestorFilters'
import InvestorsClient, { type InvestorCardData } from '@/components/investors/InvestorsClient'

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
  const [{ data: investorRows, error }, { data: investmentRows }] = await Promise.all([
    supabase
      .from('investors')
      .select('*, party:parties(id, full_name, is_organization)')
      .order('updated_at', { ascending: false }),
    supabase
      .from('investments')
      .select('*, project:projects(id, name)'),
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
        <Link
          href="/investors/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          New Investor
        </Link>
      </div>

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
