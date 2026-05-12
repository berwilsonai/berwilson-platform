'use client'

import { useMemo, useState } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useAutosave } from '@/hooks/equity-use-autosave'
import { validateCapTable, rebalanceHolders, calculateHolderValues } from '@/lib/equity/calculations/cap-table'
import { CAP_TABLE_STAGES, ERIC_OWNERSHIP_FLOOR } from '@/lib/equity/constants'
import { formatCurrency, formatPercentDisplay } from '@/lib/equity/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { AlertTriangle, Lock, Unlock } from 'lucide-react'
import CapTablePieChart from './CapTablePieChart'
import ExportShareBar from '@/components/equity/ExportShareBar'

export default function CapTableClient() {
  const { capTable, setCapTable, valuation } = useScenarioStore()
  useAutosave()

  const [companyValuation, setCompanyValuation] = useState(20_000_000)

  const validation = useMemo(() => validateCapTable(capTable.holders), [capTable.holders])
  const holderValues = useMemo(
    () => calculateHolderValues(capTable.holders, companyValuation),
    [capTable.holders, companyValuation]
  )

  function handleStageChange(stageKey: string | null) {
    if (!stageKey) return
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
              <CardTitle className="text-sm">Stage</CardTitle>
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
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Validation Warnings */}
          {!validation.valid && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                {validation.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-700">{err}</p>
                ))}
              </div>
            </div>
          )}

          {/* Holder Sliders */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Ownership Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {capTable.holders.map((holder, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs font-medium">{holder.name}</Label>
                      {holder.classB && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                          Class B
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">({holder.role})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!holder.classB && (
                        <button
                          onClick={() => toggleLock(i)}
                          className="text-muted-foreground hover:text-foreground"
                          title={holder.locked ? 'Unlock' : 'Lock'}
                        >
                          {holder.locked ? <Lock size={12} /> : <Unlock size={12} />}
                        </button>
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
                </div>
              ))}

              <div className="pt-2 border-t border-border flex justify-between text-xs">
                <span className="text-muted-foreground">Total</span>
                <span
                  className={`font-medium ${
                    Math.abs(validation.total - 100) < 0.1
                      ? 'text-emerald-600'
                      : 'text-red-600'
                  }`}
                >
                  {formatPercentDisplay(validation.total)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Valuation-based dollar values */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Dollar Values</CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground">at valuation</Label>
                  <Slider
                    value={[companyValuation]}
                    onValueChange={(v) =>
                      setCompanyValuation(Array.isArray(v) ? v[0] : v)
                    }
                    min={5_000_000}
                    max={500_000_000}
                    step={5_000_000}
                    className="w-32"
                  />
                  <span className="text-xs font-medium w-16 text-right">
                    ${(companyValuation / 1_000_000).toFixed(0)}M
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Holder</TableHead>
                    <TableHead className="text-xs text-right">%</TableHead>
                    <TableHead className="text-xs text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holderValues.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{h.name}</TableCell>
                      <TableCell className="text-xs text-right">
                        {formatPercentDisplay(h.percentage)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium">
                        {formatCurrency(h.value)}
                      </TableCell>
                    </TableRow>
                  ))}
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
