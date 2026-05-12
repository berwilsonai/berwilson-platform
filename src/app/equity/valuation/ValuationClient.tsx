'use client'

import { useMemo, useState } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { calculateBlendedValuation, reverseCalculation } from '@/lib/equity/calculations/valuation'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import ExportShareBar from '@/components/equity/ExportShareBar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SignedContract } from '@/types/equity-domain'

function sv(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : v as number
}

export default function ValuationClient() {
  const { valuation, setValuation } = useScenarioStore()
  useAutosave()

  const result = useMemo(() => calculateBlendedValuation(valuation), [valuation])

  // Reverse calculator state
  const [reverseInvestment, setReverseInvestment] = useState(1_000_000)
  const [reverseEquity1, setReverseEquity1] = useState(5)
  const [reverseEquity2, setReverseEquity2] = useState(10)

  const reverseResult1 = reverseCalculation(reverseInvestment, reverseEquity1)
  const reverseResult2 = reverseCalculation(reverseInvestment, reverseEquity2)

  // Contract editing
  function updateContract(index: number, partial: Partial<SignedContract>) {
    const updated = valuation.contracts.map((c, i) =>
      i === index ? { ...c, ...partial } : c
    )
    setValuation({ contracts: updated })
  }

  function addContract() {
    setValuation({
      contracts: [
        ...valuation.contracts,
        { name: 'New Contract', value: 10_000_000, termYears: 5, probability: 0.5, status: 'pipeline' as const },
      ],
    })
  }

  function removeContract(index: number) {
    setValuation({ contracts: valuation.contracts.filter((_, i) => i !== index) })
  }

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

      {/* Editable Contracts Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Contract Portfolio</CardTitle>
            <Button variant="outline" size="sm" onClick={addContract} className="h-7 text-xs gap-1">
              <Plus size={12} /> Add Contract
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Contract</TableHead>
                <TableHead className="text-xs text-right">Value</TableHead>
                <TableHead className="text-xs text-right">Term (yr)</TableHead>
                <TableHead className="text-xs text-right">Probability</TableHead>
                <TableHead className="text-xs text-right">Weighted Value</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {valuation.contracts.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs p-1">
                    <Input
                      value={c.name}
                      onChange={(e) => updateContract(i, { name: e.target.value })}
                      className="h-7 text-xs"
                    />
                  </TableCell>
                  <TableCell className="text-xs p-1">
                    <Input
                      type="number"
                      value={c.value}
                      onChange={(e) => updateContract(i, { value: Number(e.target.value) || 0 })}
                      className="h-7 text-xs text-right w-28"
                    />
                  </TableCell>
                  <TableCell className="text-xs p-1">
                    <Input
                      type="number"
                      value={c.termYears}
                      onChange={(e) => updateContract(i, { termYears: Number(e.target.value) || 1 })}
                      className="h-7 text-xs text-right w-16"
                      min={1}
                      max={30}
                    />
                  </TableCell>
                  <TableCell className="text-xs p-1">
                    <Input
                      type="number"
                      value={(c.probability * 100).toFixed(0)}
                      onChange={(e) => updateContract(i, { probability: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
                      className="h-7 text-xs text-right w-16"
                      min={0}
                      max={100}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-right font-medium">
                    {formatCurrencyCompact(c.value * c.probability)}
                  </TableCell>
                  <TableCell className="text-xs p-1">
                    <Select
                      value={c.status}
                      onValueChange={(v) => updateContract(i, { status: v as 'signed' | 'probable' | 'pipeline' })}
                    >
                      <SelectTrigger className="h-7 text-[10px] w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signed">Signed</SelectItem>
                        <SelectItem value="probable">Probable</SelectItem>
                        <SelectItem value="pipeline">Pipeline</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeContract(i)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 size={12} />
                    </Button>
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
                <Label className="text-[10px]">Contract Term (Years)</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.contractTermYears]}
                    onValueChange={(v) => setValuation({ contractTermYears: sv(v) })}
                    min={1}
                    max={20}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.contractTermYears}yr
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Net Margin Low</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.netMarginLow * 100]}
                    onValueChange={(v) => setValuation({ netMarginLow: sv(v) / 100 })}
                    min={1}
                    max={30}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.netMarginLow * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Net Margin High</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.netMarginHigh * 100]}
                    onValueChange={(v) => setValuation({ netMarginHigh: sv(v) / 100 })}
                    min={valuation.netMarginLow * 100}
                    max={40}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {(valuation.netMarginHigh * 100).toFixed(0)}%
                  </span>
                </div>
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
                <Label className="text-[10px]">Pipeline Discount Years</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.pipelineDiscountYears]}
                    onValueChange={(v) => setValuation({ pipelineDiscountYears: sv(v) })}
                    min={1}
                    max={15}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.pipelineDiscountYears}yr
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
                <Label className="text-[10px]">Revenue Multiple Low</Label>
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
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Revenue Multiple High</Label>
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
                <Label className="text-[10px]">EBITDA Multiple Low</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.ebitdaMultipleLow]}
                    onValueChange={(v) => setValuation({ ebitdaMultipleLow: sv(v) })}
                    min={1}
                    max={15}
                    step={0.5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.ebitdaMultipleLow.toFixed(1)}x
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">EBITDA Multiple High</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.ebitdaMultipleHigh]}
                    onValueChange={(v) => setValuation({ ebitdaMultipleHigh: sv(v) })}
                    min={valuation.ebitdaMultipleLow}
                    max={25}
                    step={0.5}
                  />
                  <span className="text-[10px] font-medium w-10 text-right">
                    {valuation.ebitdaMultipleHigh.toFixed(1)}x
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
              <div className="space-y-1.5">
                <Label className="text-[10px]">Total Patent Count</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.patents.totalCount]}
                    onValueChange={(v) =>
                      setValuation({ patents: { ...valuation.patents, totalCount: sv(v) } })
                    }
                    min={0}
                    max={500}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-8 text-right">
                    {valuation.patents.totalCount}
                  </span>
                </div>
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
                <div className="flex items-center gap-1">
                  <Label className="text-[9px] text-muted-foreground">Value each:</Label>
                  <Input
                    type="number"
                    value={valuation.patents.valuePerProvisional}
                    onChange={(e) =>
                      setValuation({ patents: { ...valuation.patents, valuePerProvisional: Number(e.target.value) || 0 } })
                    }
                    className="h-5 text-[9px] w-20"
                  />
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
                <div className="flex items-center gap-1">
                  <Label className="text-[9px] text-muted-foreground">Value each:</Label>
                  <Input
                    type="number"
                    value={valuation.patents.valuePerNonProvisional}
                    onChange={(e) =>
                      setValuation({ patents: { ...valuation.patents, valuePerNonProvisional: Number(e.target.value) || 0 } })
                    }
                    className="h-5 text-[9px] w-20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Granted</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.patents.granted]}
                    onValueChange={(v) =>
                      setValuation({ patents: { ...valuation.patents, granted: sv(v) } })
                    }
                    min={0}
                    max={valuation.patents.nonProvisionalFiled}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-8 text-right">
                    {valuation.patents.granted}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-[9px] text-muted-foreground">Value each:</Label>
                  <Input
                    type="number"
                    value={valuation.patents.valuePerGranted}
                    onChange={(e) =>
                      setValuation({ patents: { ...valuation.patents, valuePerGranted: Number(e.target.value) || 0 } })
                    }
                    className="h-5 text-[9px] w-20"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px]">Commercially Evaluated</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.patents.commerciallyEvaluated]}
                    onValueChange={(v) =>
                      setValuation({ patents: { ...valuation.patents, commerciallyEvaluated: sv(v) } })
                    }
                    min={0}
                    max={valuation.patents.granted}
                    step={1}
                  />
                  <span className="text-[10px] font-medium w-8 text-right">
                    {valuation.patents.commerciallyEvaluated}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-[9px] text-muted-foreground">Value each:</Label>
                  <Input
                    type="number"
                    value={valuation.patents.valuePerCommercial}
                    onChange={(e) =>
                      setValuation({ patents: { ...valuation.patents, valuePerCommercial: Number(e.target.value) || 0 } })
                    }
                    className="h-5 text-[9px] w-20"
                  />
                </div>
              </div>

              <Separator />

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
                <Label className="text-[10px]">Brand & Marks Value</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.brandAndMarksValue]}
                    onValueChange={(v) => setValuation({ brandAndMarksValue: sv(v) })}
                    min={0}
                    max={5_000_000}
                    step={100_000}
                  />
                  <span className="text-[10px] font-medium w-12 text-right">
                    {formatCurrencyCompact(valuation.brandAndMarksValue)}
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
                <Label className="text-[10px]">Relationships Value</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[valuation.relationshipsValue]}
                    onValueChange={(v) => setValuation({ relationshipsValue: sv(v) })}
                    min={0}
                    max={10_000_000}
                    step={250_000}
                  />
                  <span className="text-[10px] font-medium w-12 text-right">
                    {formatCurrencyCompact(valuation.relationshipsValue)}
                  </span>
                </div>
              </div>

              <Separator />

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

      {/* Reverse Calculator — Fully Editable */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reverse Calculator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Investment Amount</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[reverseInvestment]}
                onValueChange={(v) => setReverseInvestment(sv(v))}
                min={100_000}
                max={50_000_000}
                step={100_000}
              />
              <span className="text-sm font-medium w-16 text-right">
                {formatCurrencyCompact(reverseInvestment)}
              </span>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="bg-muted/30 rounded-md px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-[10px]">Target Equity %</Label>
                <Input
                  type="number"
                  value={reverseEquity1}
                  onChange={(e) => setReverseEquity1(Math.max(0.1, Number(e.target.value) || 1))}
                  className="h-6 text-xs w-16"
                  min={0.1}
                  max={49}
                  step={0.5}
                />
              </div>
              <p className="text-xs text-muted-foreground">{formatPercentDisplay(reverseEquity1)} equity &rarr;</p>
              <p className="text-sm font-bold">{formatCurrency(reverseResult1)} valuation</p>
            </div>
            <div className="bg-muted/30 rounded-md px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-[10px]">Target Equity %</Label>
                <Input
                  type="number"
                  value={reverseEquity2}
                  onChange={(e) => setReverseEquity2(Math.max(0.1, Number(e.target.value) || 1))}
                  className="h-6 text-xs w-16"
                  min={0.1}
                  max={49}
                  step={0.5}
                />
              </div>
              <p className="text-xs text-muted-foreground">{formatPercentDisplay(reverseEquity2)} equity &rarr;</p>
              <p className="text-sm font-bold">{formatCurrency(reverseResult2)} valuation</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
