'use client'

import { useMemo } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateAllDealFees, calculateTotalLifetimeFees } from '@/lib/equity/calculations/originator-fees'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import ExportShareBar from '@/components/equity/ExportShareBar'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function OriginatorFeesClient() {
  const { originatorFees, setOriginatorFees } = useScenarioStore()
  useAutosave()

  const results = useMemo(
    () =>
      calculateAllDealFees(
        originatorFees.sampleDeals,
        originatorFees.tiers,
        originatorFees.netMarginAssumption
      ),
    [originatorFees]
  )

  const totalLifetime = useMemo(
    () => calculateTotalLifetimeFees(results),
    [results]
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Originator Fee Calculator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calculate tiered originator fees on sourced deals across different contract sizes.
          </p>
        </div>
        <ExportShareBar />
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left: Controls */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Assumptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Net Margin Assumption</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[originatorFees.netMarginAssumption * 100]}
                    onValueChange={(v) =>
                      setOriginatorFees({ netMarginAssumption: sv(v) / 100 })
                    }
                    min={5}
                    max={20}
                    step={1}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {(originatorFees.netMarginAssumption * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Tail Period</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[originatorFees.tailMonths]}
                    onValueChange={(v) =>
                      setOriginatorFees({ tailMonths: sv(v) })
                    }
                    min={0}
                    max={36}
                    step={6}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {originatorFees.tailMonths} mo
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Period after intro within which a signed contract qualifies
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Fee Tier Schedule */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Fee Tiers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {originatorFees.tiers.map((tier, i) => (
                  <div
                    key={i}
                    className="bg-muted/30 rounded-md px-3 py-2 text-xs space-y-0.5"
                  >
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {formatCurrencyCompact(tier.contractSizeMin)} &ndash;{' '}
                        {tier.contractSizeMax === Infinity
                          ? 'Above'
                          : formatCurrencyCompact(tier.contractSizeMax)}
                      </span>
                      <span className="font-medium">
                        {(tier.netProfitPercentage * 100).toFixed(1)}% of net profit
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Capped at {formatCurrency(tier.perDealCap)} per deal
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Total */}
          <Card className="border-amber-300 bg-amber-50/30">
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Total Lifetime Originator Fees
              </p>
              <p className="text-2xl font-bold text-amber-700">
                {formatCurrency(totalLifetime)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Across {results.length} deals
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right: Deal Results */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sample Deal Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Deal</TableHead>
                    <TableHead className="text-xs text-right">Contract</TableHead>
                    <TableHead className="text-xs text-right">Net Profit</TableHead>
                    <TableHead className="text-xs text-right">Originator Fee</TableHead>
                    <TableHead className="text-xs text-right">Annual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">
                        {r.dealName}
                        {r.capApplied && (
                          <Badge variant="secondary" className="ml-1 text-[8px] px-1 py-0">
                            capped
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        {formatCurrencyCompact(r.contractRevenue)}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        {formatCurrencyCompact(r.netProfit)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium text-amber-700">
                        {formatCurrency(r.originatorFee)}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        {formatCurrencyCompact(r.annualFee)}/yr
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="text-xs font-bold">Total</TableCell>
                    <TableCell className="text-xs text-right font-medium">
                      {formatCurrencyCompact(
                        results.reduce((sum, r) => sum + r.contractRevenue, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right font-medium">
                      {formatCurrencyCompact(
                        results.reduce((sum, r) => sum + r.netProfit, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-amber-700">
                      {formatCurrency(totalLifetime)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* How fees compare to equity value */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fee Structure Explained</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <p>
                Originator fees are calculated on <strong>net profit</strong> (not gross revenue) from
                contracts the originator sources. They are subject to per-deal caps that increase with contract size.
              </p>
              <p>
                Fees are paid quarterly for the life of each sourced contract, regardless of the originator&apos;s
                employment status, provided they remain a shareholder in good standing.
              </p>
              <p>
                A deal qualifies as &ldquo;originator-sourced&rdquo; if they make a documented introduction and
                the counterparty enters into a contract within <strong>{originatorFees.tailMonths} months</strong> of the introduction.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
