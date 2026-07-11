import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, HandCoins, StickyNote } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import { formatValue, formatDate } from '@/lib/utils/constants'
import {
  raiseStatus,
  investmentStage,
  instrumentLabel,
  investorStage,
  RAISE_STATUS_LABELS,
  RAISE_STATUS_BADGE,
  INVESTMENT_STAGE_LABELS,
  INVESTMENT_STAGE_BADGE,
  INVESTOR_STAGE_LABELS,
} from '@/lib/utils/investors'
import { parseTranches, raiseLevels, fillTranches } from '@/lib/investors/raises'
import RaiseTrancheBar, { TrancheBarLegend } from '@/components/investors/RaiseTrancheBar'
import RaiseDeleteButton from '@/components/investors/RaiseDeleteButton'
import { isPastDate } from '@/components/investors/InvestorsClient'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const { data } = await createAdminClient().from('raises').select('name').eq('id', id).single()
  return { title: `${data?.name ?? 'Raise'} — Ber Wilson Intelligence` }
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

export default async function RaiseDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: raise } = await supabase
    .from('raises')
    .select('*, project:projects(id, name)')
    .eq('id', id)
    .single()

  if (!raise) notFound()

  const { data: investments } = await supabase
    .from('investments')
    .select('*, investor:investors(id, name, stage, interest_level), project:projects(id, name)')
    .eq('raise_id', id)

  const signed = (i: { amount_funded: number | null; amount_committed: number | null }) =>
    Math.max(i.amount_funded ?? 0, i.amount_committed ?? 0)
  const rows = (investments ?? []).sort(
    (a, b) => signed(b) - signed(a) || (b.amount_indicated ?? 0) - (a.amount_indicated ?? 0)
  )

  const levels = raiseLevels(rows)
  const explicitTranches = parseTranches(raise.tranches)
  // No tranche schedule → treat the whole target as one tranche so the bar
  // still reads; no target either → no bar.
  const tranches =
    explicitTranches.length > 0
      ? explicitTranches
      : raise.target_amount != null
        ? [{ label: 'Full raise', amount: raise.target_amount, target_date: raise.target_close_date }]
        : []
  const fills = fillTranches(tranches, levels)

  const status = raiseStatus(raise.status)
  const target = raise.target_amount
  const project = raise.project as { id: string; name: string } | null
  const targetLabel = raise.target_kind === 'company' ? 'Ber Wilson (parent)' : project?.name ?? 'Project'
  const pctOf = (v: number) => (target ? ` · ${Math.round((v / target) * 100)}% of target` : '')
  const gap = target != null ? target - levels.potential : null

  const investorCount = new Set(rows.map((r) => r.investor_id)).size

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link href="/investors" className="text-muted-foreground hover:text-foreground transition-colors">
          Investors
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{raise.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', RAISE_STATUS_BADGE[status])}>
              {RAISE_STATUS_LABELS[status]}
            </span>
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {raise.target_kind === 'project' && project ? (
                <Link href={`/projects/${project.id}`} className="hover:text-primary transition-colors">
                  {targetLabel}
                </Link>
              ) : (
                targetLabel
              )}
            </span>
          </div>
          <h1 className="text-xl font-semibold leading-tight">{raise.name}</h1>
          {(raise.open_date || raise.target_close_date) && (
            <p className="text-xs text-muted-foreground">
              {raise.open_date && <>Opened {formatDate(raise.open_date)}</>}
              {raise.open_date && raise.target_close_date && ' · '}
              {raise.target_close_date && <>Target close {formatDate(raise.target_close_date)}</>}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/investors/raises/${id}/edit`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Pencil size={13} />
            Edit
          </Link>
          <RaiseDeleteButton raiseId={id} name={raise.name} />
        </div>
      </div>

      {/* Money band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Target" value={formatValue(target)} sub={explicitTranches.length > 0 ? `${explicitTranches.length} tranches` : undefined} />
        <Stat label="Committed" value={formatValue(levels.committed)} sub={`Signed${pctOf(levels.committed)}`} />
        <Stat label="Funded" value={formatValue(levels.funded)} sub={`Wired${pctOf(levels.funded)}`} />
        <Stat
          label="Potential"
          value={formatValue(levels.potential)}
          sub={
            gap != null
              ? gap > 0
                ? `${formatValue(gap)} uncovered even if all indications convert`
                : 'Covers the target if all indications convert'
              : 'If all indications convert'
          }
        />
      </div>

      {/* Tranche waterfall */}
      {fills.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 elev-1 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Tranche Fill <span className="font-normal normal-case">(commitments fill in order)</span>
            </h2>
            <TrancheBarLegend />
          </div>
          <RaiseTrancheBar tranches={fills} size="lg" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-medium py-1.5 pr-3">Tranche</th>
                  <th className="text-right font-medium py-1.5 px-3">Amount</th>
                  <th className="text-right font-medium py-1.5 px-3">Committed</th>
                  <th className="text-right font-medium py-1.5 px-3">Funded</th>
                  <th className="text-right font-medium py-1.5 px-3">To Commit</th>
                  <th className="text-right font-medium py-1.5 pl-3">Target Date</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((t, idx) => {
                  const remaining = t.amount - t.committed
                  // A past target date on a tranche that isn't fully committed
                  // is a schedule slip — surface it.
                  const slipped = remaining > 0 && status !== 'closed' && isPastDate(t.target_date)
                  return (
                    <tr key={idx} className="border-t border-border">
                      <td className="py-2 pr-3 font-medium">{t.label}</td>
                      <td className="py-2 px-3 text-right tnum">{formatValue(t.amount)}</td>
                      <td className="py-2 px-3 text-right tnum">{t.committed > 0 ? formatValue(t.committed) : '—'}</td>
                      <td className="py-2 px-3 text-right tnum">{t.funded > 0 ? formatValue(t.funded) : '—'}</td>
                      <td className={cn('py-2 px-3 text-right tnum', remaining <= 0 && 'text-emerald-600 dark:text-emerald-400 font-medium')}>
                        {remaining <= 0 ? 'Full' : formatValue(remaining)}
                      </td>
                      <td
                        className={cn(
                          'py-2 pl-3 text-right whitespace-nowrap',
                          slipped ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'
                        )}
                      >
                        {t.target_date ? formatDate(t.target_date) : '—'}
                        {slipped && ' · slipped'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Investors on this raise */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <HandCoins size={15} /> Investors{investorCount > 0 && <span className="text-muted-foreground font-normal">({investorCount})</span>}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No investments tagged to this raise yet. Tag them from an investor&apos;s page — add or edit an
            investment and pick this raise.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-card elev-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-medium py-2 pl-4 pr-3">Investor</th>
                  <th className="text-left font-medium py-2 px-3">Deal Stage</th>
                  <th className="text-left font-medium py-2 px-3">Instrument</th>
                  <th className="text-right font-medium py-2 px-3">Indicated</th>
                  <th className="text-right font-medium py-2 px-3">Committed</th>
                  <th className="text-right font-medium py-2 px-3">Funded</th>
                  <th className="text-left font-medium py-2 pl-3 pr-4">Next Step</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const investor = inv.investor as { id: string; name: string; stage: string } | null
                  const ds = investmentStage(inv.stage)
                  return (
                    <tr key={inv.id} className="border-t border-border">
                      <td className="py-2.5 pl-4 pr-3">
                        {investor ? (
                          <Link href={`/investors/${investor.id}`} className="font-medium hover:text-primary transition-colors">
                            {investor.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                        {investor && (
                          <span className="block text-[11px] text-muted-foreground">
                            {INVESTOR_STAGE_LABELS[investorStage(investor.stage)]}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', INVESTMENT_STAGE_BADGE[ds])}>
                          {INVESTMENT_STAGE_LABELS[ds]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{instrumentLabel(inv.instrument) ?? '—'}</td>
                      <td className="py-2.5 px-3 text-right tnum">{formatValue(inv.amount_indicated)}</td>
                      <td className="py-2.5 px-3 text-right tnum">{formatValue(inv.amount_committed)}</td>
                      <td className="py-2.5 px-3 text-right tnum">{formatValue(inv.amount_funded)}</td>
                      <td className="py-2.5 pl-3 pr-4 text-xs text-muted-foreground max-w-[220px] truncate">{inv.next_step ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/40">
                  <td className="py-2 pl-4 pr-3 text-xs font-medium" colSpan={3}>
                    Totals
                  </td>
                  <td className="py-2 px-3 text-right tnum font-semibold">{formatValue(levels.indicated_raw)}</td>
                  <td className="py-2 px-3 text-right tnum font-semibold">{formatValue(levels.committed_raw)}</td>
                  <td className="py-2 px-3 text-right tnum font-semibold">{formatValue(levels.funded_raw)}</td>
                  <td className="py-2 pl-3 pr-4" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Notes */}
      {raise.notes && (
        <section>
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            <StickyNote size={13} /> Notes
          </h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{raise.notes}</p>
        </section>
      )}
    </div>
  )
}
