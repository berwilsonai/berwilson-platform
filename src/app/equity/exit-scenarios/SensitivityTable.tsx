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

export default function SensitivityTable({ results, baselinePayout }: Props) {
  return (
    <div className="overflow-x-auto">
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
          {/* Baseline row */}
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
  )
}
