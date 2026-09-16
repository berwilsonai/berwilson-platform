import { formatValue } from '@/lib/utils/constants'
import type { ReferralSourceCard } from '@/lib/steel/rollups'

/**
 * Referral fees owed to marketing / referral sources (any contact), rolled up
 * per source across their deals. Owed/Paid count collected deals; Projected is
 * open deals that haven't been collected yet.
 *
 * A source credited on a deal with no fee agreed is listed with a "needs a fee"
 * count rather than omitted — an attributed-but-unpriced deal is the one that
 * quietly never gets paid.
 */
export default function ReferralSourceTable({ sources }: { sources: ReferralSourceCard[] }) {
  const totals = sources.reduce(
    (a, s) => ({
      deals: a.deals + s.dealCount,
      unpriced: a.unpriced + s.unpricedDealCount,
      owed: a.owed + s.owed,
      paid: a.paid + s.paid,
      projected: a.projected + s.projected,
      total: a.total + s.total,
    }),
    { deals: 0, unpriced: 0, owed: 0, paid: 0, projected: 0, total: 0 }
  )

  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label-caps text-muted-foreground">Marketing / Referral Fees by Source</h2>
        {totals.total > 0 && (
          <span className="text-sm font-semibold tnum">{formatValue(totals.total)} total</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
              <th className="font-medium pb-2 pr-3">Source</th>
              <th className="font-medium pb-2 px-3 text-right">Deals</th>
              <th className="font-medium pb-2 px-3 text-right">Owed</th>
              <th className="font-medium pb-2 px-3 text-right">Paid</th>
              <th className="font-medium pb-2 px-3 text-right">Projected</th>
              <th className="font-medium pb-2 pl-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {sources.map((s) => (
              <tr key={s.partyId} className="border-t border-border">
                <td className="py-2 pr-3">
                  <span className="font-medium">{s.name}</span>
                  {s.unpricedDealCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
                      {`${s.unpricedDealCount} ${s.unpricedDealCount === 1 ? 'needs' : 'need'} a fee`}
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right text-muted-foreground">{s.dealCount}</td>
                <td className="py-2 px-3 text-right text-amber-600 dark:text-amber-400">{formatValue(s.owed)}</td>
                <td className="py-2 px-3 text-right text-emerald-600 dark:text-emerald-400">{formatValue(s.paid)}</td>
                <td className="py-2 px-3 text-right text-muted-foreground">{formatValue(s.projected)}</td>
                <td className="py-2 pl-3 text-right font-medium">{formatValue(s.total)}</td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-xs text-muted-foreground">
                  No marketing / referral source is credited on any deal yet. Set one (and its fee) when you edit a deal.
                </td>
              </tr>
            )}
          </tbody>
          {sources.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-border tnum">
                <td className="py-2 pr-3 text-[11px] uppercase tracking-wide text-muted-foreground">All sources</td>
                <td className="py-2 px-3 text-right text-muted-foreground">{totals.deals}</td>
                <td className="py-2 px-3 text-right font-medium">{formatValue(totals.owed)}</td>
                <td className="py-2 px-3 text-right font-medium">{formatValue(totals.paid)}</td>
                <td className="py-2 px-3 text-right font-medium">{formatValue(totals.projected)}</td>
                <td className="py-2 pl-3 text-right font-semibold">{formatValue(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Mark referral fees paid in the Outstanding Payouts list above (they appear once a deal is collected).
        {totals.unpriced > 0 &&
          ` ${totals.unpriced} ${totals.unpriced === 1 ? 'deal credits' : 'deals credit'} a marketing source with no fee agreed — set a flat amount or a % of margin on the deal.`}
      </p>
    </section>
  )
}
