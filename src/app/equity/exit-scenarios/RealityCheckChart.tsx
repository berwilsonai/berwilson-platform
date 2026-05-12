'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { ExitResult } from '@/types/equity-domain'
import { formatCurrencyCompact, formatCurrency } from '@/lib/equity/format'

interface Props {
  results: ExitResult[]
  baselinePayout: number
}

export default function RealityCheckChart({ results, baselinePayout }: Props) {
  const data = results.map((r) => ({
    label: formatCurrencyCompact(r.exitValuation),
    ericPayout: r.ericPayout,
    exitValuation: r.exitValuation,
  }))

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <YAxis
            tickFormatter={(v: number) => formatCurrencyCompact(v)}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <Tooltip
            formatter={(value) => [formatCurrency(Number(value)), "Eric's Payout"]}
            labelFormatter={(label) => `Exit at ${label}`}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
            }}
          />
          <ReferenceLine
            y={baselinePayout}
            stroke="#ef4444"
            strokeDasharray="5 5"
            label={{
              value: `100% unfunded: ${formatCurrencyCompact(baselinePayout)}`,
              position: 'insideTopRight',
              fill: '#ef4444',
              fontSize: 10,
            }}
          />
          <Bar dataKey="ericPayout" radius={[4, 4, 0, 0]} maxBarSize={60}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.ericPayout > baselinePayout ? '#1e293b' : '#94a3b8'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
