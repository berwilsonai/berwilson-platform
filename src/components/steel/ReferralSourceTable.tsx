import { formatValue } from '@/lib/utils/constants'
import type { ReferralSourceCard } from '@/lib/steel/rollups'

/**
 * Referral fees owed to marketing / referral sources (any contact), rolled up
 * per source across their deals. Owed/Paid count collected deals; Projected is
 * open deals that haven't been collected yet.
 */
export default function ReferralSourceTable({ sources }: { sources: ReferralSourceCard[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label-caps text-muted-foreground">Referral Fees by Source</h2>
        <span className="text-[11px] text-muted-foreground">Marketing / referral sources</span>
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
                <td className="py-2 pr-3 font-medium">{s.name}</td>
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
                  No referral fees yet. Set a marketing / referral source and a fee on a deal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Mark referral fees paid in the Outstanding Payouts list above (they appear once a deal is collected).
      </p>
    </section>
  )
}
