'use client'

import type { ExitResult } from '@/types/equity-domain'
import { formatCurrency, formatCurrencyCompact, formatMultiplier } from '@/lib/equity/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Props {
  results: ExitResult[]
  baselinePayout: number
}

function MobileCard({
  r,
  baselinePayout,
}: {
  r: ExitResult
  baselinePayout?: number
}) {
  const isBaseline = !r.exitValuation && baselinePayout !== undefined
  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        isBaseline ? 'border-red-200 bg-red-50/50' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${isBaseline ? 'text-red-700' : 'text-foreground'}`}>
          {isBaseline ? 'Unfunded Baseline' : formatCurrencyCompact(r.exitValuation)}
        </span>
        {!isBaseline && (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              r.multiplier > 1
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {formatMultiplier(r.multiplier)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-muted-foreground">Eric&apos;s Payout</span>
          <p className={`font-medium ${isBaseline ? 'text-red-700' : 'text-foreground'}`}>
            {formatCurrency(isBaseline ? baselinePayout! : r.ericPayout)}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Investor</span>
          <p className="font-medium">{isBaseline ? '$0' : formatCurrency(r.investorPayout)}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Others</span>
          <p className="font-medium">{isBaseline ? '$0' : formatCurrency(r.otherHoldersPayout)}</p>
        </div>
        {!isBaseline && (
          <div>
            <span className="text-muted-foreground">vs. Unfunded</span>
            <p className={`font-medium ${r.netGain > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {r.netGain > 0 ? '+' : ''}
              {formatCurrency(r.netGain)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SensitivityTable({ results, baselinePayout }: Props) {
  return (
    <>
      {/* Mobile: card stack */}
      <div className="md:hidden space-y-2">
        <MobileCard
          r={{ exitValuation: 0, ericPayout: baselinePayout, investorPayout: 0, otherHoldersPayout: 0, netGain: 0, multiplier: 1 } as ExitResult}
          baselinePayout={baselinePayout}
        />
        {results.map((r) => (
          <MobileCard key={r.exitValuation} r={r} />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Exit Valuation</TableHead>
              <TableHead className="text-xs text-right">Eric&apos;s Payout</TableHead>
              <TableHead className="text-xs text-right">Investor&apos;s Payout</TableHead>
              <TableHead className="text-xs text-right">Others&apos; Payout</TableHead>
              <TableHead className="text-xs text-right">vs. Unfunded</TableHead>
              <TableHead className="text-xs text-right">Multiplier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-red-50/50">
              <TableCell className="text-xs font-medium text-red-700">
                100% Unfunded Baseline
              </TableCell>
              <TableCell className="text-xs text-right text-red-700 font-medium">
                {formatCurrency(baselinePayout)}
              </TableCell>
              <TableCell className="text-xs text-right text-muted-foreground">$0</TableCell>
              <TableCell className="text-xs text-right text-muted-foreground">$0</TableCell>
              <TableCell className="text-xs text-right text-muted-foreground">&mdash;</TableCell>
              <TableCell className="text-xs text-right text-muted-foreground">1.0x</TableCell>
            </TableRow>

            {results.map((r) => (
              <TableRow key={r.exitValuation}>
                <TableCell className="text-xs font-medium">
                  {formatCurrencyCompact(r.exitValuation)}
                </TableCell>
                <TableCell className="text-xs text-right font-medium">
                  {formatCurrency(r.ericPayout)}
                </TableCell>
                <TableCell className="text-xs text-right">
                  {formatCurrency(r.investorPayout)}
                </TableCell>
                <TableCell className="text-xs text-right">
                  {formatCurrency(r.otherHoldersPayout)}
                </TableCell>
                <TableCell
                  className={`text-xs text-right font-medium ${
                    r.netGain > 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {r.netGain > 0 ? '+' : ''}
                  {formatCurrency(r.netGain)}
                </TableCell>
                <TableCell
                  className={`text-xs text-right font-medium ${
                    r.multiplier > 1 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {formatMultiplier(r.multiplier)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
