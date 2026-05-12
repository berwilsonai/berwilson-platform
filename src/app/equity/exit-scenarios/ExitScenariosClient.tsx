'use client'

import { useMemo, useState } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateAllExitResults, calculateBaselinePayout, generateRealityCheckText } from '@/lib/equity/calculations/exit-scenarios'
import { calculateConversionEquity } from '@/lib/equity/calculations/investor-deal'
import { formatCurrency, formatCurrencyCompact, formatMultiplier, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Link2 } from 'lucide-react'
import RealityCheckChart from './RealityCheckChart'
import SensitivityTable from './SensitivityTable'
import ExportShareBar from '@/components/equity/ExportShareBar'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function ExitScenariosClient() {
  const { exitScenarios, setExitScenarios, investorDeal } = useScenarioStore()
  useAutosave()

  const results = useMemo(
    () => calculateAllExitResults(exitScenarios),
    [exitScenarios]
  )

  const baselinePayout = useMemo(
    () => calculateBaselinePayout(exitScenarios),
    [exitScenarios]
  )

  // Compute investor equity from Investor Deal Modeler for cross-screen link
  const investorEquityPct = useMemo(
    () => calculateConversionEquity(investorDeal),
    [investorDeal]
  )

  const primaryExitVal = exitScenarios.exitValuations[2] ?? exitScenarios.exitValuations[exitScenarios.exitValuations.length - 1] ?? 200_000_000
  const primaryResult = results.find((r) => r.exitValuation === primaryExitVal) ?? results[0]

  const realityCheckText = primaryResult ? generateRealityCheckText(primaryResult) : ''

  // Exit valuation editing
  const [newExitVal, setNewExitVal] = useState(100_000_000)

  function addExitValuation() {
    if (exitScenarios.exitValuations.includes(newExitVal)) return
    const updated = [...exitScenarios.exitValuations, newExitVal].sort((a, b) => a - b)
    setExitScenarios({ exitValuations: updated })
  }

  function removeExitValuation(val: number) {
    if (exitScenarios.exitValuations.length <= 1) return
    setExitScenarios({ exitValuations: exitScenarios.exitValuations.filter((v) => v !== val) })
  }

  function linkFromInvestorDeal() {
    setExitScenarios({
      investorInvestment: investorDeal.investmentAmount,
      ericPercentage: Math.max(51, 100 - investorEquityPct - investorDeal.advisorGrantPercentage),
    })
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Exit Scenarios & Reality Check
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            See what each stakeholder receives at different exit valuations. This is the most important view.
          </p>
        </div>
        <ExportShareBar />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left: Input Controls */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Scenario Inputs</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={linkFromInvestorDeal}
                  className="h-6 text-[9px] gap-1 px-2"
                  title="Pull investment amount and equity from Investor Deal Modeler"
                >
                  <Link2 size={10} /> From Deal Modeler
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs">Eric&apos;s Ownership</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.ericPercentage]}
                    onValueChange={(v) => setExitScenarios({ ericPercentage: sv(v) })}
                    min={51}
                    max={100}
                    step={0.1}
                  />
                  <span className="text-sm font-medium w-14 text-right">
                    {exitScenarios.ericPercentage.toFixed(1)}%
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">Minimum 51% (regulatory requirement)</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Exit Year</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.exitYear]}
                    onValueChange={(v) => setExitScenarios({ exitYear: sv(v) })}
                    min={1}
                    max={20}
                    step={1}
                  />
                  <span className="text-sm font-medium w-14 text-right">
                    Year {exitScenarios.exitYear}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Investor&apos;s Investment</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.investorInvestment]}
                    onValueChange={(v) => setExitScenarios({ investorInvestment: sv(v) })}
                    min={0}
                    max={50_000_000}
                    step={500_000}
                  />
                  <span className="text-sm font-medium w-20 text-right">
                    {formatCurrencyCompact(exitScenarios.investorInvestment)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Liquidation Preference</Label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exitScenarios.hasLiquidationPreference}
                    onChange={(e) =>
                      setExitScenarios({ hasLiquidationPreference: e.target.checked })
                    }
                    className="rounded border-border"
                  />
                  <span className="text-xs text-muted-foreground">
                    Investor gets preference
                  </span>
                </label>
              </div>

              {exitScenarios.hasLiquidationPreference && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">Preference Multiple</Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[exitScenarios.investorPreferenceMultiple]}
                        onValueChange={(v) => setExitScenarios({ investorPreferenceMultiple: sv(v) })}
                        min={1}
                        max={3}
                        step={0.25}
                      />
                      <span className="text-sm font-medium w-12 text-right">
                        {exitScenarios.investorPreferenceMultiple.toFixed(2)}x
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Participating Preferred</Label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exitScenarios.investorParticipating}
                        onChange={(e) =>
                          setExitScenarios({ investorParticipating: e.target.checked })
                        }
                        className="rounded border-border"
                      />
                      <span className="text-xs text-muted-foreground">
                        Investor participates in remaining proceeds after preference
                      </span>
                    </label>
                    {exitScenarios.investorParticipating && (
                      <p className="text-[10px] text-amber-600">
                        Participating preferred: investor gets liquidation preference PLUS pro-rata share of remaining proceeds. More investor-friendly.
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Baseline (Unfunded) Assumptions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Baseline (Unfunded) Assumptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Baseline Contract Value</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.baselineContractValue]}
                    onValueChange={(v) => setExitScenarios({ baselineContractValue: sv(v) })}
                    min={1_000_000}
                    max={500_000_000}
                    step={1_000_000}
                  />
                  <span className="text-sm font-medium w-20 text-right">
                    {formatCurrencyCompact(exitScenarios.baselineContractValue)}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  The &ldquo;100% of nothing&rdquo; case: what Eric earns if he never gives up equity
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Baseline Term (Years)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.baselineTermYears]}
                    onValueChange={(v) => setExitScenarios({ baselineTermYears: sv(v) })}
                    min={1}
                    max={20}
                    step={1}
                  />
                  <span className="text-sm font-medium w-14 text-right">
                    {exitScenarios.baselineTermYears}yr
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Baseline Net Margin</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.baselineNetMargin * 100]}
                    onValueChange={(v) => setExitScenarios({ baselineNetMargin: sv(v) / 100 })}
                    min={1}
                    max={25}
                    step={1}
                  />
                  <span className="text-sm font-medium w-14 text-right">
                    {(exitScenarios.baselineNetMargin * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Baseline Win Probability</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.baselineProbability * 100]}
                    onValueChange={(v) => setExitScenarios({ baselineProbability: sv(v) / 100 })}
                    min={10}
                    max={100}
                    step={5}
                  />
                  <span className="text-sm font-medium w-14 text-right">
                    {(exitScenarios.baselineProbability * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Probability of winning the baseline contract without funding
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Editable Exit Valuations */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Exit Valuations to Model</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {exitScenarios.exitValuations.map((val) => (
                <div key={val} className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-1.5">
                  <span className="text-xs font-medium">{formatCurrencyCompact(val)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeExitValuation(val)}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                    disabled={exitScenarios.exitValuations.length <= 1}
                  >
                    <Trash2 size={11} />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="number"
                  value={newExitVal}
                  onChange={(e) => setNewExitVal(Number(e.target.value) || 0)}
                  className="h-7 text-xs flex-1"
                  placeholder="Exit valuation"
                />
                <Button variant="outline" size="sm" onClick={addExitValuation} className="h-7 text-xs gap-1">
                  <Plus size={12} /> Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Charts and Results */}
        <div className="space-y-6">
          {/* Reality Check Hero Card */}
          {primaryResult && (
            <Card className="border-amber-300 bg-amber-50/30">
              <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Eric&apos;s {exitScenarios.ericPercentage.toFixed(0)}% at{' '}
                      {formatCurrencyCompact(primaryResult.exitValuation)} Exit
                    </p>
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(primaryResult.ericPayout)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      100% Unfunded (Lifetime Profit)
                    </p>
                    <p className="text-2xl font-bold text-slate-400">
                      {formatCurrency(baselinePayout)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Eric Is Better Off By
                    </p>
                    <p className="text-2xl font-bold text-emerald-600">
                      {formatMultiplier(primaryResult.multiplier)}
                    </p>
                    <p className="text-xs text-emerald-600 font-medium">
                      +{formatCurrency(primaryResult.netGain)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-white/60 rounded-md">
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    {realityCheckText}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Eric&apos;s Payout by Exit Valuation</CardTitle>
            </CardHeader>
            <CardContent>
              <RealityCheckChart results={results} baselinePayout={baselinePayout} />
            </CardContent>
          </Card>

          {/* Full Results Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Detailed Exit Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <SensitivityTable results={results} baselinePayout={baselinePayout} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
