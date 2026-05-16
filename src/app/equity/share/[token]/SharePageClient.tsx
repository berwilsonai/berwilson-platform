'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertTriangle, Lock } from 'lucide-react'
import { formatCurrency, formatCurrencyCompact, formatPercentDisplay, formatMultiplier } from '@/lib/equity/format'
import { calculateBlendedValuation } from '@/lib/equity/calculations/valuation'
import { calculateAllExitResults, calculateBaselinePayout } from '@/lib/equity/calculations/exit-scenarios'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LEGAL_DISCLAIMER } from '@/lib/equity/constants'

type ShareData = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenario: any
  modules: string[]
  expiresAt: string
}

export default function SharePageClient() {
  const params = useParams()
  const token = params.token as string
  const [data, setData] = useState<ShareData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/equity/share/${token}`)
        if (!res.ok) {
          const body = await res.json()
          setError(body.error ?? 'Failed to load shared scenario')
          return
        }
        setData(await res.json())
      } catch {
        setError('Network error loading shared scenario')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle size={32} className="text-amber-500" />
        <h1 className="text-lg font-semibold">{error}</h1>
        <p className="text-sm text-muted-foreground">This link may have expired or reached its access limit.</p>
      </div>
    )
  }

  if (!data) return null

  const { scenario, modules, expiresAt } = data
  const valInputs = scenario.valuation_inputs ?? {}
  const capInputs = scenario.cap_table_inputs ?? {}
  const exitInputs = scenario.exit_scenario_inputs ?? {}

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Lock size={14} />
          <span className="text-xs">Shared View — Read Only</span>
        </div>
        <h1 className="text-xl font-semibold">{scenario.name}</h1>
        <p className="text-xs text-muted-foreground">
          Expires {new Date(expiresAt).toLocaleDateString()}
        </p>
      </div>

      {/* Exit Scenarios */}
      {modules.includes('exit-scenarios') && exitInputs.exitValuations && (() => {
        const results = calculateAllExitResults(exitInputs)
        const baseline = calculateBaselinePayout(exitInputs)
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Exit Scenarios</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="text-center p-3 bg-amber-50 rounded-md">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Eric&apos;s Ownership</p>
                  <p className="text-lg font-bold">{formatPercentDisplay(exitInputs.ericPercentage)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-md">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Unfunded Baseline</p>
                  <p className="text-lg font-bold text-slate-400">{formatCurrencyCompact(baseline)}</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-md">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Best Exit Multiplier</p>
                  <p className="text-lg font-bold text-emerald-600">
                    {formatMultiplier(Math.max(...results.map(r => r.multiplier)))}
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Exit Valuation</TableHead>
                    <TableHead className="text-xs text-right">Eric&apos;s Payout</TableHead>
                    <TableHead className="text-xs text-right">Investor Payout</TableHead>
                    <TableHead className="text-xs text-right">Multiplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.exitValuation}>
                      <TableCell className="text-xs font-medium">{formatCurrencyCompact(r.exitValuation)}</TableCell>
                      <TableCell className="text-xs text-right">{formatCurrency(r.ericPayout)}</TableCell>
                      <TableCell className="text-xs text-right">{formatCurrency(r.investorPayout)}</TableCell>
                      <TableCell className={`text-xs text-right font-medium ${r.multiplier > 1 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatMultiplier(r.multiplier)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })()}

      {/* Cap Table */}
      {modules.includes('cap-table') && capInputs.holders && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cap Table</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Holder</TableHead>
                  <TableHead className="text-xs">Role</TableHead>
                  <TableHead className="text-xs text-right">%</TableHead>
                  <TableHead className="text-xs">Class</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(capInputs.holders as any[]).map((h: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{h.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{h.role}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatPercentDisplay(h.percentage)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {h.classB ? 'Class B' : 'Class A'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Valuation */}
      {modules.includes('valuation') && valInputs.weightDCF !== undefined && (() => {
        const result = calculateBlendedValuation(valInputs)
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Valuation Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-4">
                <div className="text-center p-3 bg-slate-50 rounded-md">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Conservative</p>
                  <p className="text-lg font-bold">{formatCurrencyCompact(result.blended.low)}</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-md">
                  <p className="text-xs uppercase text-amber-600 mb-1">Blended Mid</p>
                  <p className="text-xl font-bold text-amber-700">{formatCurrencyCompact(result.blended.mid)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-md">
                  <p className="text-xs uppercase text-muted-foreground mb-1">Optimistic</p>
                  <p className="text-lg font-bold">{formatCurrencyCompact(result.blended.high)}</p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Method</TableHead>
                    <TableHead className="text-xs text-right">Low</TableHead>
                    <TableHead className="text-xs text-right">Mid</TableHead>
                    <TableHead className="text-xs text-right">High</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs font-medium">DCF</TableCell>
                    <TableCell className="text-xs text-right">{formatCurrencyCompact(result.dcf.low)}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatCurrencyCompact(result.dcf.mid)}</TableCell>
                    <TableCell className="text-xs text-right">{formatCurrencyCompact(result.dcf.high)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Multiples</TableCell>
                    <TableCell className="text-xs text-right">{formatCurrencyCompact(result.multiples.low)}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatCurrencyCompact(result.multiples.mid)}</TableCell>
                    <TableCell className="text-xs text-right">{formatCurrencyCompact(result.multiples.high)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium">Assets & IP</TableCell>
                    <TableCell className="text-xs text-right">{formatCurrencyCompact(result.assets.low)}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{formatCurrencyCompact(result.assets.mid)}</TableCell>
                    <TableCell className="text-xs text-right">{formatCurrencyCompact(result.assets.high)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })()}

      {/* Footer */}
      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground/60 leading-tight text-center">
          {LEGAL_DISCLAIMER}
        </p>
      </div>
    </div>
  )
}
