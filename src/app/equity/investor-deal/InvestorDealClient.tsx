'use client'

import { useMemo } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateInvestorDealResult, calculateConversionEquity } from '@/lib/equity/calculations/investor-deal'
import { calculateBlendedValuation } from '@/lib/equity/calculations/valuation'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Link2, Unlink } from 'lucide-react'
import ExportShareBar from '@/components/equity/ExportShareBar'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function InvestorDealClient() {
  const { investorDeal, setInvestorDeal, valuation } = useScenarioStore()
  useAutosave()

  const blendedValuation = useMemo(() => calculateBlendedValuation(valuation), [valuation])

  const equityPct = useMemo(() => calculateConversionEquity(investorDeal), [investorDeal])
  const result = useMemo(() => calculateInvestorDealResult(investorDeal), [investorDeal])

  const sweetSpotMax = investorDeal.valuationCap * (investorDeal.maxParentEquityFromInvestment)
  const isOverCap = investorDeal.investmentAmount > sweetSpotMax

  // Dynamically generate sweet spot amounts around the current investment
  const sweetSpotAmounts = useMemo(() => {
    const base = investorDeal.investmentAmount
    const candidates = new Set<number>()
    // Always include some standard amounts
    ;[500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000].forEach((a) => candidates.add(a))
    // Add the current amount and nearby values
    candidates.add(base)
    if (base > 1_000_000) candidates.add(Math.round(base * 0.5 / 500_000) * 500_000)
    candidates.add(Math.round(base * 1.5 / 500_000) * 500_000)
    candidates.add(Math.round(base * 2 / 500_000) * 500_000)
    return [...candidates].filter((a) => a >= 250_000 && a <= 50_000_000).sort((a, b) => a - b).slice(0, 8)
  }, [investorDeal.investmentAmount])

  function useBlendedValuation() {
    setInvestorDeal({ valuationCap: Math.round(blendedValuation.blended.mid) })
  }

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

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left: Inputs */}
        <div className="space-y-5">
          {/* Investor Name */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Investor</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={investorDeal.investorName}
                onChange={(e) => setInvestorDeal({ investorName: e.target.value })}
                placeholder="Investor name"
                className="h-8 text-sm"
              />
            </CardContent>
          </Card>

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
                  <TabsTrigger value="convertible_note" className="text-xs flex-1">Note</TabsTrigger>
                  <TabsTrigger value="safe" className="text-xs flex-1">SAFE</TabsTrigger>
                  <TabsTrigger value="preferred_equity_subsidiary" className="text-xs flex-1">Preferred</TabsTrigger>
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
                    min={100_000}
                    max={50_000_000}
                    step={100_000}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {formatCurrencyCompact(investorDeal.investmentAmount)}
                  </span>
                </div>
                {isOverCap && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Above {formatCurrencyCompact(sweetSpotMax)} exceeds {(investorDeal.maxParentEquityFromInvestment * 100).toFixed(0)}% parent cap.
                    Excess would come in as subsidiary-level preferred equity.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Valuation Cap</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={useBlendedValuation}
                    className="h-6 text-xs gap-1 px-2"
                    title="Use blended valuation from Valuation Calculator"
                  >
                    <Link2 size={10} /> Use Blended ({formatCurrencyCompact(blendedValuation.blended.mid)})
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.valuationCap]}
                    onValueChange={(v) => setInvestorDeal({ valuationCap: sv(v) })}
                    min={1_000_000}
                    max={500_000_000}
                    step={1_000_000}
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
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">Interest Rate</Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[investorDeal.interestRate * 100]}
                        onValueChange={(v) => setInvestorDeal({ interestRate: sv(v) / 100 })}
                        min={0}
                        max={10}
                        step={0.25}
                      />
                      <span className="text-sm font-medium w-12 text-right">
                        {(investorDeal.interestRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Maturity (Months)</Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[investorDeal.maturityMonths]}
                        onValueChange={(v) => setInvestorDeal({ maturityMonths: sv(v) })}
                        min={6}
                        max={60}
                        step={6}
                      />
                      <span className="text-sm font-medium w-12 text-right">
                        {investorDeal.maturityMonths}mo
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Months Until Conversion</Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[investorDeal.monthsUntilConversion]}
                        onValueChange={(v) => setInvestorDeal({ monthsUntilConversion: sv(v) })}
                        min={3}
                        max={investorDeal.maturityMonths}
                        step={3}
                      />
                      <span className="text-sm font-medium w-12 text-right">
                        {investorDeal.monthsUntilConversion}mo
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Next Round Valuation</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.nextRoundValuation]}
                    onValueChange={(v) => setInvestorDeal({ nextRoundValuation: sv(v) })}
                    min={5_000_000}
                    max={1_000_000_000}
                    step={5_000_000}
                  />
                  <span className="text-sm font-medium w-16 text-right">
                    {formatCurrencyCompact(investorDeal.nextRoundValuation)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Max Parent Equity from Investment</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.maxParentEquityFromInvestment * 100]}
                    onValueChange={(v) => setInvestorDeal({ maxParentEquityFromInvestment: sv(v) / 100 })}
                    min={1}
                    max={49}
                    step={1}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {(investorDeal.maxParentEquityFromInvestment * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Cap on parent-level equity from this investment</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Advisor Grant</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.advisorGrantPercentage]}
                    onValueChange={(v) => setInvestorDeal({ advisorGrantPercentage: sv(v) })}
                    min={0}
                    max={3}
                    step={0.25}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {investorDeal.advisorGrantPercentage.toFixed(2)}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Operational Package */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Operational Package</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Salary</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.operationalSalary]}
                    onValueChange={(v) => setInvestorDeal({ operationalSalary: sv(v) })}
                    min={0}
                    max={500_000}
                    step={25_000}
                  />
                  <span className="text-sm font-medium w-20 text-right">
                    {formatCurrencyCompact(investorDeal.operationalSalary)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Annual Bonus</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.operationalBonus]}
                    onValueChange={(v) => setInvestorDeal({ operationalBonus: sv(v) })}
                    min={0}
                    max={200_000}
                    step={10_000}
                  />
                  <span className="text-sm font-medium w-20 text-right">
                    {formatCurrencyCompact(investorDeal.operationalBonus)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Contract Duration (Years)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.operationalContractYears]}
                    onValueChange={(v) => setInvestorDeal({ operationalContractYears: sv(v) })}
                    min={1}
                    max={15}
                    step={1}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {investorDeal.operationalContractYears}yr
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Severance (Months)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[investorDeal.operationalSeverance]}
                    onValueChange={(v) => setInvestorDeal({ operationalSeverance: sv(v) })}
                    min={0}
                    max={24}
                    step={1}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {investorDeal.operationalSeverance}mo
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Severance value: {formatCurrency(((investorDeal.operationalSalary + investorDeal.operationalBonus) / 12) * investorDeal.operationalSeverance)}
                </p>
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
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Investor Equity at Conversion
                </p>
                <p className="text-2xl font-bold text-foreground">
                  {formatPercentDisplay(equityPct)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Total Package (Year 5)
                </p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {formatCurrencyCompact(result.totalPackageYear5)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
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
              <CardTitle className="text-sm">5-Lane Package Summary — {investorDeal.investorName}</CardTitle>
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
                    <TableCell className="text-xs text-right font-bold text-amber-600 dark:text-amber-400">
                      {formatCurrency(result.totalPackageYear5)}
                    </TableCell>
                    <TableCell className="text-xs text-right font-bold text-amber-600 dark:text-amber-400">
                      {formatCurrency(result.totalPackageYear10)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Investment Sweet Spot — Dynamic */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Investment vs. Equity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sweetSpotAmounts.map((amt) => {
                  const pct = calculateConversionEquity({ ...investorDeal, investmentAmount: amt })
                  const underCap = pct <= investorDeal.maxParentEquityFromInvestment * 100
                  return (
                    <button
                      key={amt}
                      onClick={() => setInvestorDeal({ investmentAmount: amt })}
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-md text-xs transition-colors ${
                        amt === investorDeal.investmentAmount
                          ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60'
                          : 'bg-muted/30 hover:bg-muted/50'
                      }`}
                    >
                      <span className="font-medium">{formatCurrencyCompact(amt)}</span>
                      <span className="text-muted-foreground">&rarr;</span>
                      <span className={`font-medium ${underCap ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {formatPercentDisplay(pct)} equity
                      </span>
                      {!underCap && (
                        <span className="text-xs text-amber-500 dark:text-amber-400">exceeds cap</span>
                      )}
                    </button>
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
