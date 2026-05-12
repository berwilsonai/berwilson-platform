'use client'

import { useMemo } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateAllExitResults, calculateBaselinePayout, generateRealityCheckText } from '@/lib/equity/calculations/exit-scenarios'
import { formatCurrency, formatCurrencyCompact, formatMultiplier } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import RealityCheckChart from './RealityCheckChart'
import SensitivityTable from './SensitivityTable'
import ExportShareBar from '@/components/equity/ExportShareBar'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function ExitScenariosClient() {
  const { exitScenarios, setExitScenarios } = useScenarioStore()
  useAutosave()

  const results = useMemo(
    () => calculateAllExitResults(exitScenarios),
    [exitScenarios]
  )

  const baselinePayout = useMemo(
    () => calculateBaselinePayout(exitScenarios),
    [exitScenarios]
  )

  const primaryExitVal = exitScenarios.exitValuations[2] ?? 200_000_000
  const primaryResult = results.find((r) => r.exitValuation === primaryExitVal) ?? results[0]

  const realityCheckText = primaryResult ? generateRealityCheckText(primaryResult) : ''

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

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left: Input Controls */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Scenario Inputs</CardTitle>
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
                    Investor gets {exitScenarios.investorPreferenceMultiple}x preference
                  </span>
                </label>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Baseline Contract Value</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.baselineContractValue]}
                    onValueChange={(v) => setExitScenarios({ baselineContractValue: sv(v) })}
                    min={5_000_000}
                    max={500_000_000}
                    step={5_000_000}
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
                <Label className="text-xs">Baseline Net Margin</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[exitScenarios.baselineNetMargin * 100]}
                    onValueChange={(v) => setExitScenarios({ baselineNetMargin: sv(v) / 100 })}
                    min={5}
                    max={20}
                    step={1}
                  />
                  <span className="text-sm font-medium w-14 text-right">
                    {(exitScenarios.baselineNetMargin * 100).toFixed(0)}%
                  </span>
                </div>
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
