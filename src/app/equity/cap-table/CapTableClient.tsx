'use client'

import { useMemo, useState } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { validateCapTable, rebalanceHolders, calculateHolderValues, simulateDilution } from '@/lib/equity/calculations/cap-table'
import { calculateBlendedValuation } from '@/lib/equity/calculations/valuation'
import { CAP_TABLE_STAGES, ERIC_OWNERSHIP_FLOOR } from '@/lib/equity/constants'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertTriangle, Lock, Unlock, Plus, Trash2, Link2 } from 'lucide-react'
import CapTablePieChart from './CapTablePieChart'
import ExportShareBar from '@/components/equity/ExportShareBar'

export default function CapTableClient() {
  const { capTable, setCapTable, valuation } = useScenarioStore()
  useAutosave()

  const blendedValuation = useMemo(() => calculateBlendedValuation(valuation), [valuation])
  const [companyValuation, setCompanyValuation] = useState(20_000_000)
  const [useBlended, setUseBlended] = useState(false)

  const activeValuation = useBlended ? Math.round(blendedValuation.blended.mid) : companyValuation

  // Dilution simulator state
  const [dilutionPercent, setDilutionPercent] = useState(5)

  const validation = useMemo(() => validateCapTable(capTable.holders), [capTable.holders])
  const holderValues = useMemo(
    () => calculateHolderValues(capTable.holders, activeValuation),
    [capTable.holders, activeValuation]
  )

  // Simulate dilution preview
  const dilutedHolders = useMemo(
    () => simulateDilution(capTable.holders, dilutionPercent),
    [capTable.holders, dilutionPercent]
  )

  function handleStageChange(stageKey: string | null) {
    if (!stageKey) return
    if (stageKey === 'custom') return // keep current holders
    const stage = CAP_TABLE_STAGES[stageKey as keyof typeof CAP_TABLE_STAGES]
    if (!stage) return
    setCapTable({
      stage: stageKey,
      holders: stage.holders.map((h) => ({
        ...h,
        locked: h.classB,
        vested: h.classB ? 100 : 0,
      })),
    })
  }

  function handlePercentageChange(index: number, newPct: number) {
    const holder = capTable.holders[index]
    if (holder.classB && newPct < ERIC_OWNERSHIP_FLOOR) return
    const rebalanced = rebalanceHolders(capTable.holders, index, newPct)
    setCapTable({ holders: rebalanced })
  }

  function toggleLock(index: number) {
    const updated = capTable.holders.map((h, i) =>
      i === index ? { ...h, locked: !h.locked } : h
    )
    setCapTable({ holders: updated })
  }

  function updateHolderField(index: number, field: 'name' | 'role', value: string) {
    const updated = capTable.holders.map((h, i) =>
      i === index ? { ...h, [field]: value } : h
    )
    setCapTable({ holders: updated })
  }

  function updateVesting(index: number, vested: number) {
    const updated = capTable.holders.map((h, i) =>
      i === index ? { ...h, vested } : h
    )
    setCapTable({ holders: updated })
  }

  function addHolder() {
    // Distribute some percentage from the largest non-Class-B unlocked holder
    const newHolder = {
      name: 'New Holder',
      percentage: 0,
      role: 'Advisor',
      classB: false,
      locked: false,
      vested: 0,
    }
    setCapTable({
      stage: 'custom',
      holders: [...capTable.holders, newHolder],
    })
  }

  function removeHolder(index: number) {
    const holder = capTable.holders[index]
    if (holder.classB) return // can't remove Eric
    const pctToRedistribute = holder.percentage
    const remaining = capTable.holders.filter((_, i) => i !== index)
    // Give it back to the Class B holder (Eric)
    const updated = remaining.map((h) =>
      h.classB ? { ...h, percentage: h.percentage + pctToRedistribute } : h
    )
    setCapTable({ stage: 'custom', holders: updated })
  }

  function applyDilution() {
    setCapTable({ stage: 'custom', holders: dilutedHolders })
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cap Table Simulator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visualize ownership across stages. Eric&apos;s {ERIC_OWNERSHIP_FLOOR}% floor is enforced.
          </p>
        </div>
        <ExportShareBar />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: Controls + Table */}
        <div className="space-y-5">
          {/* Stage Selector */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Stage</CardTitle>
                <Button variant="outline" size="sm" onClick={addHolder} className="h-7 text-xs gap-1">
                  <Plus size={12} /> Add Holder
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Select value={capTable.stage} onValueChange={handleStageChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CAP_TABLE_STAGES).map(([key, stage]) => (
                    <SelectItem key={key} value={key}>
                      {stage.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Validation Warnings */}
          {!validation.valid && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-md p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                {validation.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-700 dark:text-red-300">{err}</p>
                ))}
              </div>
            </div>
          )}

          {/* Holder Sliders with Editable Names */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Ownership Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {capTable.holders.map((holder, i) => (
                <div key={i} className="space-y-1.5 pb-3 border-b border-border/50 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Input
                        value={holder.name}
                        onChange={(e) => updateHolderField(i, 'name', e.target.value)}
                        className="h-6 text-xs font-medium flex-1 min-w-0"
                        disabled={holder.classB}
                      />
                      <Input
                        value={holder.role}
                        onChange={(e) => updateHolderField(i, 'role', e.target.value)}
                        className="h-6 text-xs text-muted-foreground w-20"
                        disabled={holder.classB}
                      />
                      {holder.classB && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                          Class B
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!holder.classB && (
                        <>
                          <button
                            onClick={() => toggleLock(i)}
                            className="text-muted-foreground hover:text-foreground"
                            title={holder.locked ? 'Unlock' : 'Lock'}
                          >
                            {holder.locked ? <Lock size={12} /> : <Unlock size={12} />}
                          </button>
                          <button
                            onClick={() => removeHolder(i)}
                            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                            title="Remove holder"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                      <span className="text-sm font-medium w-16 text-right">
                        {formatPercentDisplay(holder.percentage)}
                      </span>
                    </div>
                  </div>
                  <Slider
                    value={[holder.percentage]}
                    onValueChange={(v) =>
                      handlePercentageChange(i, Array.isArray(v) ? v[0] : v)
                    }
                    min={holder.classB ? ERIC_OWNERSHIP_FLOOR : 0}
                    max={holder.classB ? 100 : 49}
                    step={0.1}
                    disabled={holder.locked && !holder.classB}
                  />
                  {/* Vesting */}
                  {!holder.classB && (
                    <div className="flex items-center gap-2 pl-1">
                      <Label className="text-xs text-muted-foreground w-10">Vested</Label>
                      <Slider
                        value={[holder.vested ?? 0]}
                        onValueChange={(v) => updateVesting(i, Array.isArray(v) ? v[0] : v)}
                        min={0}
                        max={100}
                        step={5}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-8 text-right">
                        {holder.vested ?? 0}%
                      </span>
                    </div>
                  )}
                </div>
              ))}

              <div className="pt-2 border-t border-border flex justify-between text-xs">
                <span className="text-muted-foreground">Total</span>
                <span
                  className={`font-medium ${
                    Math.abs(validation.total - 100) < 0.1
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatPercentDisplay(validation.total)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Dilution Simulator */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Dilution Simulator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Preview what happens if new equity is issued. All existing holders are diluted proportionally.
              </p>
              <div className="space-y-2">
                <Label className="text-xs">New Equity Issued</Label>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[dilutionPercent]}
                    onValueChange={(v) => setDilutionPercent(Array.isArray(v) ? v[0] : v)}
                    min={1}
                    max={30}
                    step={0.5}
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {dilutionPercent.toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="bg-muted/30 rounded-md p-2 space-y-1">
                {dilutedHolders.map((h, i) => {
                  const original = capTable.holders[i]
                  const delta = original ? h.percentage - original.percentage : 0
                  return (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{h.name}</span>
                      <span>
                        <span className="font-medium">{formatPercentDisplay(h.percentage)}</span>
                        {original && (
                          <span className="text-red-500 dark:text-red-400 ml-1">({delta.toFixed(1)}%)</span>
                        )}
                      </span>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between text-xs border-t pt-1">
                  <span className="text-muted-foreground">New Issuance</span>
                  <span className="font-medium">{formatPercentDisplay(dilutionPercent)}</span>
                </div>
              </div>

              {dilutedHolders.find((h) => h.classB && h.percentage < ERIC_OWNERSHIP_FLOOR) ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  This dilution would bring Eric below the {ERIC_OWNERSHIP_FLOOR}% floor.
                </p>
              ) : (
                <Button variant="outline" size="sm" onClick={applyDilution} className="w-full h-7 text-xs">
                  Apply Dilution to Cap Table
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Valuation-based dollar values */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Dollar Values</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant={useBlended ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setUseBlended(!useBlended)}
                    className="h-6 text-xs gap-1 px-2"
                  >
                    <Link2 size={10} />
                    {useBlended ? `Linked (${formatCurrencyCompact(activeValuation)})` : 'Link Valuation'}
                  </Button>
                  {!useBlended && (
                    <>
                      <Slider
                        value={[companyValuation]}
                        onValueChange={(v) =>
                          setCompanyValuation(Array.isArray(v) ? v[0] : v)
                        }
                        min={5_000_000}
                        max={500_000_000}
                        step={5_000_000}
                        className="w-28"
                      />
                      <span className="text-xs font-medium w-16 text-right">
                        ${(companyValuation / 1_000_000).toFixed(0)}M
                      </span>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Holder</TableHead>
                    <TableHead className="text-xs text-right">%</TableHead>
                    <TableHead className="text-xs text-right">Vested</TableHead>
                    <TableHead className="text-xs text-right">Value</TableHead>
                    <TableHead className="text-xs text-right">Vested Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holderValues.map((h, i) => {
                    const holder = capTable.holders[i]
                    const vestedPct = holder?.vested ?? (holder?.classB ? 100 : 0)
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{h.name}</TableCell>
                        <TableCell className="text-xs text-right">
                          {formatPercentDisplay(h.percentage)}
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          {vestedPct}%
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          {formatCurrency(h.value)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium text-amber-600 dark:text-amber-400">
                          {formatCurrency(h.value * (vestedPct / 100))}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Right: Pie Chart */}
        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ownership Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <CapTablePieChart holders={capTable.holders} />
              <div className="mt-4 space-y-1">
                {capTable.holders.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-muted-foreground">{h.name}</span>
                    </div>
                    <span className="font-medium">{formatPercentDisplay(h.percentage)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

const PIE_COLORS = [
  '#1e293b', // navy (Eric)
  '#d97706', // amber
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f43f5e', // rose
  '#64748b', // slate
  '#94a3b8', // light slate
]
