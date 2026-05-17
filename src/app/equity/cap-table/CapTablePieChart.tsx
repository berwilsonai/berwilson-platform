'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import type { CapTableHolder } from '@/types/equity-domain'
import { formatPercentDisplay } from '@/lib/equity/format'

const COLORS = [
  '#1e293b', // navy (Eric)
  '#d97706', // amber
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f43f5e', // rose
  '#64748b', // slate
  '#94a3b8', // light slate
]

interface Props {
  holders: CapTableHolder[]
}

export default function CapTablePieChart({ holders }: Props) {
  const data = holders
    .filter((h) => h.percentage > 0)
    .map((h) => ({
      name: h.name,
      value: h.percentage,
    }))

  return (
    <div className="h-48 sm:h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="35%"
            outerRadius="65%"
            paddingAngle={2}
            dataKey="value"
            label={({ value }) =>
              value > 5 ? `${formatPercentDisplay(value)}` : ''
            }
            labelLine={false}
          >
            {data.map((_entry, index) => (
              <Cell
                key={index}
                fill={COLORS[index % COLORS.length]}
                stroke="white"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [formatPercentDisplay(Number(value)), 'Ownership']}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e2e8f0',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
