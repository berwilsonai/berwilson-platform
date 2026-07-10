import Link from 'next/link'
import { HandCoins } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import FinancingTab from '@/components/projects/FinancingTab'
import type { FinancingWithSchedule } from '@/types/domain'
import type { DrawScheduleEntry } from '@/types/domain'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import {
  investmentStage,
  instrumentLabel,
  INVESTMENT_STAGE_LABELS,
  INVESTMENT_STAGE_BADGE,
} from '@/lib/utils/investors'

export const metadata = { title: 'Financing — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FinancingPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data }, { data: investments }] = await Promise.all([
    supabase
      .from('financing_structures')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Tolerant of the investors migration not being applied yet (null → hidden).
    supabase
      .from('investments')
      .select('*, investor:investors(id, name)')
      .eq('project_id', id)
      .order('created_at', { ascending: true }),
  ])

  // Cast the JSONB draw_schedule to the typed domain shape
  const financing: FinancingWithSchedule | null = data
    ? {
        ...data,
        draw_schedule: Array.isArray(data.draw_schedule)
          ? (data.draw_schedule as unknown as DrawScheduleEntry[])
          : null,
      }
    : null

  const invRows = investments ?? []
  const sum = (key: 'amount_indicated' | 'amount_committed' | 'amount_funded') =>
    invRows.reduce((acc, i) => acc + (i[key] ?? 0), 0)

  return (
    <div className="space-y-6">
      <FinancingTab projectId={id} initialFinancing={financing} />

      {/* Investors targeting this project / its SPV */}
      {invRows.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <HandCoins size={15} /> Investors
            </h2>
            <span className="text-xs text-muted-foreground tnum">
              {formatValue(sum('amount_committed'))} committed · {formatValue(sum('amount_funded'))} funded
            </span>
          </div>
          <ul className="space-y-2">
            {invRows.map((inv) => {
              const s = investmentStage(inv.stage)
              const investor = inv.investor as { id: string; name: string } | null
              return (
                <li
                  key={inv.id}
                  className="rounded-lg border border-border bg-card px-4 py-3 elev-1 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    {investor ? (
                      <Link
                        href={`/investors/${investor.id}`}
                        className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
                      >
                        {investor.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">Investor</span>
                    )}
                    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', INVESTMENT_STAGE_BADGE[s])}>
                      {INVESTMENT_STAGE_LABELS[s]}
                    </span>
                    {inv.instrument && (
                      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {instrumentLabel(inv.instrument)}
                      </span>
                    )}
                    {inv.equity_pct != null && (
                      <span className="text-[11px] text-muted-foreground">Equity {inv.equity_pct}%</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                    <span>Committed <span className="font-semibold tnum text-foreground">{formatValue(inv.amount_committed)}</span></span>
                    <span>Funded <span className="font-semibold tnum text-foreground">{formatValue(inv.amount_funded)}</span></span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
