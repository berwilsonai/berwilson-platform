'use client'

import { useMemo } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateInvestorDealResult, calculateConversionEquity } from '@/lib/equity/calculations/investor-deal'
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import type { NoteType } from '@/types/equity-domain'
import ExportShareBar from '@/components/equity/ExportShareBar'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function InvestorDealClient() {
  const { investorDeal, setInvestorDeal } = useScenarioStore()
  useAutosave()

  const equityPct = useMemo(() => calculateConversionEquity(investorDeal), [investorDeal])
  const result = useMemo(() => calculateInvestorDealResult(investorDeal), [investorDeal])

  const sweetSpotMax = investorDeal.valuationCap * (investorDeal.maxParentEquityFromInvestment)
  const isOverCap = investorDeal.investmentAmount > sweetSpotMax

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Investor Deal Modeler</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Model different investment structures and see the full 5-lane package.
          </p>
        </div>
        <ExportShareBar />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left: Inputs */}
        <div className="space-y-5">
          {/* Instrument Type */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Deal Structure</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs
                value={investorDeal.noteType}
                onValueChange={(v) => setInvestorDeal({ noteType: v as NoteType })}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="convertible_note" className="text-[10px] flex-1">Note</TabsTrigger>
                  <TabsTrigger value="safe" className="text-[10px] flex-1">SAFE</TabsTrigger>
                  <TabsTrigger value="preferred_equity_subsidiary" className="text-[10px] flex-1">Preferred</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardContent>
          </Card>

          {/* Investment Inputs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Investment Terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Investment Amount</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.investmentAmount]}
                    onValueChange={(v) => setInvestorDeal({ investmentAmount: sv(v) })}
                    min={500_000}
                    max={50_000_000}
                    step={500_000}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {formatCurrencyCompact(investorDeal.investmentAmount)}
                  </span>
                </div>
                {isOverCap && (
                  <p className="text-[10px] text-amber-600">
                    Above {formatCurrencyCompact(sweetSpotMax)} exceeds {(investorDeal.maxParentEquityFromInvestment * 100).toFixed(0)}% parent cap.
                    Excess would come in as subsidiary-level preferred equity.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Valuation Cap</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.valuationCap]}
                    onValueChange={(v) => setInvestorDeal({ valuationCap: sv(v) })}
                    min={10_000_000}
                    max={500_000_000}
                    step={5_000_000}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {formatCurrencyCompact(investorDeal.valuationCap)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Discount</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.discount * 100]}
                    onValueChange={(v) => setInvestorDeal({ discount: sv(v) / 100 })}
                    min={0}
                    max={30}
                    step={1}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {(investorDeal.discount * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {investorDeal.noteType === 'convertible_note' && (
                <div className="space-y-2">
                  <Label className="text-xs">Interest Rate</Label>
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[investorDeal.interestRate * 100]}
                      onValueChange={(v) => setInvestorDeal({ interestRate: sv(v) / 100 })}
                      min={0}
                      max={8}
                      step={0.5}
                    />
                    <span className="text-sm font-medium w-12 text-right">
                      {(investorDeal.interestRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Next Round Valuation</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.nextRoundValuation]}
                    onValueChange={(v) => setInvestorDeal({ nextRoundValuation: sv(v) })}
                    min={15_000_000}
                    max={1_000_000_000}
                    step={5_000_000}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {formatCurrencyCompact(investorDeal.nextRoundValuation)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Advisor Grant</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.advisorGrantPercentage]}
                    onValueChange={(v) => setInvestorDeal({ advisorGrantPercentage: sv(v) })}
                    min={0}
                    max={2}
                    step={0.25}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {investorDeal.advisorGrantPercentage.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Operational Salary</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.operationalSalary]}
                    onValueChange={(v) => setInvestorDeal({ operationalSalary: sv(v) })}
                    min={100_000}
                    max={500_000}
                    step={25_000}
                  />
                  <span className="text-sm font-medium w-20 text-right">
                    {formatCurrencyCompact(investorDeal.operationalSalary)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Results */}
        <div className="space-y-5">
          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Investor Equity at Conversion
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {formatPercentDisplay(equityPct)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Total Package (Year 5)
                </p>
                <p className="text-2xl font-bold text-amber-600">
                  {formatCurrencyCompact(result.totalPackageYear5)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Total Dilution
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {formatPercentDisplay(result.totalDilution)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 5-Lane Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">5-Lane Package Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Lane</TableHead>
                    <TableHead className="text-xs text-right">Year 0</TableHead>
                    <TableHead className="text-xs text-right">Year 5</TableHead>
                    <TableHead className="text-xs text-right">Year 10</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.lanes.map((lane, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{lane.name}</TableCell>
                      <TableCell className="text-xs text-right">
                        {lane.valueYear0 > 0 ? formatCurrency(lane.valueYear0) : '\u2014'}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        {lane.valueYear5 > 0 ? formatCurrency(lane.valueYear5) : '\u2014'}
                      </TableCell>
                      <TableCell className="text-xs text-right">
                        {lane.valueYear10 > 0 ? formatCurrency(lane.valueYear10) : '\u2014'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="text-xs font-bold">Total Package</TableCell>
                    <TableCell className="text-xs text-right font-bold">
                      {formatCurrency(result.totalPackageYear0)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-amber-600">
                      {formatCurrency(result.totalPackageYear5)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-amber-600">
                      {formatCurrency(result.totalPackageYear10)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Investment Sweet Spot */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Investment vs. Equity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000].map((amt) => {
                  const pct = calculateConversionEquity({ ...investorDeal, investmentAmount: amt })
                  const underCap = pct <= investorDeal.maxParentEquityFromInvestment * 100
                  return (
                    <div
                      key={amt}
                      className={`flex items-center justify-between px-3 py-2 rounded-md text-xs ${
                        amt === investorDeal.investmentAmount
                          ? 'bg-amber-50 border border-amber-200'
                          : 'bg-muted/30'
                      }`}
                    >
                      <span className="font-medium">{formatCurrencyCompact(amt)}</span>
                      <span className="text-muted-foreground">&rarr;</span>
                      <span className={`font-medium ${underCap ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {formatPercentDisplay(pct)} equity
                      </span>
                      {!underCap && (
                        <span className="text-[9px] text-amber-500">exceeds cap</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
