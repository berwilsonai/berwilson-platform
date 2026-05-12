'use client'

import { useMemo } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateBlendedValuation, reverseCalculation } from '@/lib/equity/calculations/valuation'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import ExportShareBar from '@/components/equity/ExportShareBar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function ValuationClient() {
  const { valuation, setValuation } = useScenarioStore()
  useAutosave()

  const result = useMemo(() => calculateBlendedValuation(valuation), [valuation])

  const reverseFor5Pct = reverseCalculation(1_000_000, 5)
  const reverseFor10Pct = reverseCalculation(1_000_000, 10)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Valuation Calculator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Three methodologies blended into a defensible valuation range.
          </p>
        </div>
        <ExportShareBar />
      </div>

      {/* Blended Result Hero */}
      <Card className="border-amber-300 bg-amber-50/30">
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Conservative</p>
              <p className="text-xl font-bold text-foreground">{formatCurrencyCompact(result.blended.low)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-amber-600 mb-1">Blended Mid</p>
              <p className="text-2xl font-bold text-amber-700">{formatCurrencyCompact(result.blended.mid)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Optimistic</p>
              <p className="text-xl font-bold text-foreground">{formatCurrencyCompact(result.blended.high)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Weights</p>
              <p className="text-xs text-muted-foreground">
                DCF {(valuation.weightDCF * 100).toFixed(0)}% / Mult {(valuation.weightMultiples * 100).toFixed(0)}% / Assets {(valuation.weightAssets * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contracts Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Contract Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Contract</TableHead>
                <TableHead className="text-xs text-right">Value</TableHead>
                <TableHead className="text-xs text-right">Term</TableHead>
                <TableHead className="text-xs text-right">Probability</TableHead>
                <TableHead className="text-xs text-right">Weighted Value</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuation.contracts.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-medium">{c.name}</TableCell>
                  <TableCell className="text-xs text-right">{formatCurrencyCompact(c.value)}</TableCell>
                  <TableCell className="text-xs text-right">{c.termYears}yr</TableCell>
                  <TableCell className="text-xs text-right">{(c.probability * 100).toFixed(0)}%</TableCell>
                  <TableCell className="text-xs text-right font-medium">
                    {formatCurrencyCompact(c.value * c.probability)}
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge
                      variant="secondary"
                      className={`text-[9px] px-1.5 py-0 ${
                        c.status === 'signed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : c.status === 'probable'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {c.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell className="text-xs font-bold">Total Weighted</TableCell>
                <TableCell className="text-xs text-right font-medium">
                  {formatCurrencyCompact(valuation.contracts.reduce((s, c) => s + c.value, 0))}
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-xs text-right font-bold text-amber-700">
                  {formatCurrencyCompact(valuation.contracts.reduce((s, c) => s + c.value * c.probability, 0))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Three Method Columns */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Method 1: DCF */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Method 1: DCF</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[9px] text-muted-foreground">Low</p>
                <p className="text-sm font-medium">{formatCurrencyCompact(result.dcf.low)}</p>
              </div>
              <div>
                <p className="text-[9px] text-amber-600">Mid</p>
                <p className="text-sm font-bold">{formatCurrencyCompact(result.dcf.mid)}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">High</p>
                <p className="text-sm font-medium">{formatCurrencyCompact(result.dcf.high)}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[10px]">Net Margin Range</Label>
                <p className="text-[10px] text-muted-foreground">
                  {(valuation.netMarginLow * 100).toFixed(0)}% &ndash; {(valuation.netMarginHigh * 100).toFixed(0)}%
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Execution Probability</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.executionProbability * 100]}
                    onValueChange={(v) => setValuation({ executionProbability: sv(v) / 100 })}
                    min={50}
                    max={100}
                    step={5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.executionProbability * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Discount Rate</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.discountRate * 100]}
                    onValueChange={(v) => setValuation({ discountRate: sv(v) / 100 })}
                    min={10}
                    max={40}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.discountRate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Pipeline Value (Probability-Weighted)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.pipelineProbabilityWeightedValue]}
                    onValueChange={(v) => setValuation({ pipelineProbabilityWeightedValue: sv(v) })}
                    min={0}
                    max={500_000_000}
                    step={5_000_000}
                  />
                  <span className="text-[10px] font-medium w-14 text-right">
                    {formatCurrencyCompact(valuation.pipelineProbabilityWeightedValue)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Weight</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.weightDCF * 100]}
                    onValueChange={(v) => {
                      const newW = sv(v) / 100
                      const remaining = 1 - newW
                      const ratio = valuation.weightMultiples + valuation.weightAssets
                      setValuation({
                        weightDCF: newW,
                        weightMultiples: ratio > 0 ? (valuation.weightMultiples / ratio) * remaining : remaining / 2,
                        weightAssets: ratio > 0 ? (valuation.weightAssets / ratio) * remaining : remaining / 2,
                      })
                    }}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.weightDCF * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Method 2: Multiples */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Method 2: Multiples</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[9px] text-muted-foreground">Low</p>
                <p className="text-sm font-medium">{formatCurrencyCompact(result.multiples.low)}</p>
              </div>
              <div>
                <p className="text-[9px] text-amber-600">Mid</p>
                <p className="text-sm font-bold">{formatCurrencyCompact(result.multiples.mid)}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">High</p>
                <p className="text-sm font-medium">{formatCurrencyCompact(result.multiples.high)}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[10px]">Revenue Multiple Range</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.revenueMultipleLow]}
                    onValueChange={(v) => setValuation({ revenueMultipleLow: sv(v) })}
                    min={0.1}
                    max={3}
                    step={0.1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.revenueMultipleLow.toFixed(1)}x
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.revenueMultipleHigh]}
                    onValueChange={(v) => setValuation({ revenueMultipleHigh: sv(v) })}
                    min={valuation.revenueMultipleLow}
                    max={5}
                    step={0.1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.revenueMultipleHigh.toFixed(1)}x
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Stage Discount</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.stageDiscount * 100]}
                    onValueChange={(v) => setValuation({ stageDiscount: sv(v) / 100 })}
                    min={0}
                    max={70}
                    step={5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.stageDiscount * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Strategic Premium</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.strategicPremium]}
                    onValueChange={(v) => setValuation({ strategicPremium: sv(v) })}
                    min={1}
                    max={5}
                    step={0.1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.strategicPremium.toFixed(1)}x
                  </span>
                </div>
                <p className="text-[9px] text-muted-foreground">
                  Certifications, IP, tribal preference
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Weight</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.weightMultiples * 100]}
                    onValueChange={(v) => {
                      const newW = sv(v) / 100
                      const remaining = 1 - newW
                      const ratio = valuation.weightDCF + valuation.weightAssets
                      setValuation({
                        weightMultiples: newW,
                        weightDCF: ratio > 0 ? (valuation.weightDCF / ratio) * remaining : remaining / 2,
                        weightAssets: ratio > 0 ? (valuation.weightAssets / ratio) * remaining : remaining / 2,
                      })
                    }}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.weightMultiples * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Method 3: Assets/IP */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Method 3: Assets & IP</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[9px] text-muted-foreground">Low</p>
                <p className="text-sm font-medium">{formatCurrencyCompact(result.assets.low)}</p>
              </div>
              <div>
                <p className="text-[9px] text-amber-600">Mid</p>
                <p className="text-sm font-bold">{formatCurrencyCompact(result.assets.mid)}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground">High</p>
                <p className="text-sm font-medium">{formatCurrencyCompact(result.assets.high)}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <Label className="text-[10px]">Patents ({valuation.patents.totalCount} total)</Label>
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  Unfiled patents have minimal legal protection until provisional applications are filed (~$300 each).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Provisional Filed</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.patents.provisionalFiled]}
                    onValueChange={(v) =>
                      setValuation({
                        patents: { ...valuation.patents, provisionalFiled: sv(v) },
                      })
                    }
                    min={0}
                    max={valuation.patents.totalCount}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-8 text-right">
                    {valuation.patents.provisionalFiled}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Non-Provisional Filed</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.patents.nonProvisionalFiled]}
                    onValueChange={(v) =>
                      setValuation({
                        patents: { ...valuation.patents, nonProvisionalFiled: sv(v) },
                      })
                    }
                    min={0}
                    max={valuation.patents.provisionalFiled}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-8 text-right">
                    {valuation.patents.nonProvisionalFiled}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Trade Secrets Value</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.tradeSecretsValue]}
                    onValueChange={(v) => setValuation({ tradeSecretsValue: sv(v) })}
                    min={0}
                    max={10_000_000}
                    step={250_000}
                  />
                  <span className="text-[10px] font-medium w-12 text-right">
                    {formatCurrencyCompact(valuation.tradeSecretsValue)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Certifications Value</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.certificationsValue]}
                    onValueChange={(v) => setValuation({ certificationsValue: sv(v) })}
                    min={0}
                    max={5_000_000}
                    step={100_000}
                  />
                  <span className="text-[10px] font-medium w-12 text-right">
                    {formatCurrencyCompact(valuation.certificationsValue)}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Weight</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.weightAssets * 100]}
                    onValueChange={(v) => {
                      const newW = sv(v) / 100
                      const remaining = 1 - newW
                      const ratio = valuation.weightDCF + valuation.weightMultiples
                      setValuation({
                        weightAssets: newW,
                        weightDCF: ratio > 0 ? (valuation.weightDCF / ratio) * remaining : remaining / 2,
                        weightMultiples: ratio > 0 ? (valuation.weightMultiples / ratio) * remaining : remaining / 2,
                      })
                    }}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.weightAssets * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reverse Calculator */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reverse Calculator</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            For a $1M investment to result in a given equity percentage, the post-money valuation must be:
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="bg-muted/30 rounded-md px-3 py-2">
              <p className="text-xs text-muted-foreground">5% equity &rarr;</p>
              <p className="text-sm font-bold">{formatCurrency(reverseFor5Pct)} valuation</p>
            </div>
            <div className="bg-muted/30 rounded-md px-3 py-2">
              <p className="text-xs text-muted-foreground">10% equity &rarr;</p>
              <p className="text-sm font-bold">{formatCurrency(reverseFor10Pct)} valuation</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
