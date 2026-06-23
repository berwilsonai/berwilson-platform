'use client'

import { useMemo } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateAllDealFees, calculateTotalLifetimeFees } from '@/lib/equity/calculations/originator-fees'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Link2 } from 'lucide-react'
import ExportShareBar from '@/components/equity/ExportShareBar'
import type { OriginatorFeeTier, SampleDeal } from '@/types/equity-domain'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function OriginatorFeesClient() {
  const { originatorFees, setOriginatorFees, valuation } = useScenarioStore()
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

  // Tier editing
  function updateTier(index: number, partial: Partial<OriginatorFeeTier>) {
    const updated = originatorFees.tiers.map((t, i) =>
      i === index ? { ...t, ...partial } : t
    )
    setOriginatorFees({ tiers: updated })
  }

  function addTier() {
    const lastTier = originatorFees.tiers[originatorFees.tiers.length - 1]
    const newMin = lastTier ? lastTier.contractSizeMax : 0
    setOriginatorFees({
      tiers: [
        ...originatorFees.tiers,
        {
          contractSizeMin: newMin === Infinity ? 1_000_000_000 : newMin,
          contractSizeMax: Infinity,
          netProfitPercentage: 0.01,
          perDealCap: 5_000_000,
        },
      ],
    })
  }

  function removeTier(index: number) {
    if (originatorFees.tiers.length <= 1) return
    setOriginatorFees({ tiers: originatorFees.tiers.filter((_, i) => i !== index) })
  }

  // Deal editing
  function updateDeal(index: number, partial: Partial<SampleDeal>) {
    const updated = originatorFees.sampleDeals.map((d, i) =>
      i === index ? { ...d, ...partial } : d
    )
    setOriginatorFees({ sampleDeals: updated })
  }

  function addDeal() {
    setOriginatorFees({
      sampleDeals: [
        ...originatorFees.sampleDeals,
        { name: 'New Deal', contractRevenue: 50_000_000, durationYears: 5 },
      ],
    })
  }

  function removeDeal(index: number) {
    setOriginatorFees({ sampleDeals: originatorFees.sampleDeals.filter((_, i) => i !== index) })
  }

  // Import contracts from Valuation Calculator
  function importFromValuation() {
    const deals: SampleDeal[] = valuation.contracts.map((c) => ({
      name: c.name,
      contractRevenue: c.value,
      durationYears: c.termYears,
    }))
    setOriginatorFees({ sampleDeals: deals })
  }

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

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
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
                    min={1}
                    max={25}
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
                    step={3}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {originatorFees.tailMonths} mo
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Period after intro within which a signed contract qualifies
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Editable Fee Tiers */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Fee Tiers</CardTitle>
                <Button variant="outline" size="sm" onClick={addTier} className="h-7 text-xs gap-1">
                  <Plus size={12} /> Add Tier
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {originatorFees.tiers.map((tier, i) => (
                <div
                  key={i}
                  className="bg-muted/30 rounded-md px-3 py-2 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">Tier {i + 1}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTier(i)}
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                      disabled={originatorFees.tiers.length <= 1}
                    >
                      <Trash2 size={10} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Min Contract</Label>
                      <Input
                        type="number"
                        value={tier.contractSizeMin}
                        onChange={(e) => updateTier(i, { contractSizeMin: Number(e.target.value) || 0 })}
                        className="h-6 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Max Contract</Label>
                      <Input
                        type="number"
                        value={tier.contractSizeMax === Infinity ? '' : tier.contractSizeMax}
                        onChange={(e) => updateTier(i, { contractSizeMax: e.target.value === '' ? Infinity : Number(e.target.value) || 0 })}
                        className="h-6 text-xs"
                        placeholder="No limit"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">% of Net Profit</Label>
                      <div className="flex items-center gap-1">
                        <Slider
                          value={[tier.netProfitPercentage * 100]}
                          onValueChange={(v) => updateTier(i, { netProfitPercentage: sv(v) / 100 })}
                          min={0.5}
                          max={15}
                          step={0.5}
                        />
                        <span className="text-xs font-medium w-10 text-right">
                          {(tier.netProfitPercentage * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Per-Deal Cap</Label>
                      <Input
                        type="number"
                        value={tier.perDealCap}
                        onChange={(e) => updateTier(i, { perDealCap: Number(e.target.value) || 0 })}
                        className="h-6 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Total */}
          <Card className="border-amber-300 dark:border-amber-700/60 bg-amber-50/30 dark:bg-amber-950/40">
            <CardContent className="pt-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Total Lifetime Originator Fees
              </p>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                {formatCurrency(totalLifetime)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Across {results.length} deals
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right: Deal Results */}
        <div className="space-y-5">
          {/* Editable Deals Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Deal Portfolio</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={importFromValuation}
                    className="h-7 text-xs gap-1"
                    title="Import contracts from Valuation Calculator"
                  >
                    <Link2 size={10} /> From Valuation
                  </Button>
                  <Button variant="outline" size="sm" onClick={addDeal} className="h-7 text-xs gap-1">
                    <Plus size={12} /> Add Deal
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Deal</TableHead>
                    <TableHead className="text-xs text-right">Contract</TableHead>
                    <TableHead className="text-xs text-right">Duration</TableHead>
                    <TableHead className="text-xs text-right">Net Profit</TableHead>
                    <TableHead className="text-xs text-right">Originator Fee</TableHead>
                    <TableHead className="text-xs text-right">Annual</TableHead>
                    <TableHead className="text-xs w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => {
                    const deal = originatorFees.sampleDeals[i]
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs p-1">
                          <Input
                            value={deal?.name ?? r.dealName}
                            onChange={(e) => updateDeal(i, { name: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell className="text-xs p-1">
                          <Input
                            type="number"
                            value={deal?.contractRevenue ?? r.contractRevenue}
                            onChange={(e) => updateDeal(i, { contractRevenue: Number(e.target.value) || 0 })}
                            className="h-7 text-xs text-right w-28"
                          />
                        </TableCell>
                        <TableCell className="text-xs p-1">
                          <Input
                            type="number"
                            value={deal?.durationYears ?? 5}
                            onChange={(e) => updateDeal(i, { durationYears: Number(e.target.value) || 1 })}
                            className="h-7 text-xs text-right w-14"
                            min={1}
                            max={30}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {formatCurrencyCompact(r.netProfit)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium text-amber-700 dark:text-amber-300">
                          {formatCurrency(r.originatorFee)}
                          {r.capApplied && (
                            <Badge variant="secondary" className="ml-1 text-[8px] px-1 py-0">
                              capped
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          {formatCurrencyCompact(r.annualFee)}/yr
                        </TableCell>
                        <TableCell className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeDeal(i)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  <TableRow className="border-t-2">
                    <TableCell className="text-xs font-bold">Total</TableCell>
                    <TableCell className="text-xs text-right font-medium">
                      {formatCurrencyCompact(
                        results.reduce((sum, r) => sum + r.contractRevenue, 0)
                      )}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-xs text-right font-medium">
                      {formatCurrencyCompact(
                        results.reduce((sum, r) => sum + r.netProfit, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-amber-700 dark:text-amber-300">
                      {formatCurrency(totalLifetime)}
                    </TableCell>
                    <TableCell />
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
