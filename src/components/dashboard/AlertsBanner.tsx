'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react'

interface Alert {
  type: 'critical' | 'overdue' | 'review'
  text: string
  href: string
}

export default function AlertsBanner({ alerts }: { alerts: Alert[] }) {
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  if (dismissed || alerts.length === 0) return null

  const criticalCount = alerts.filter(a => a.type === 'critical').length
  const overdueCount = alerts.filter(a => a.type === 'overdue').length

  const displayed = expanded ? alerts : alerts.slice(0, 3)
  const hasMore = alerts.length > 3

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <AlertTriangle size={14} className="text-red-600 shrink-0" />
        <span className="text-xs font-semibold text-red-800 flex-1">
          {criticalCount > 0 && `${criticalCount} critical item${criticalCount !== 1 ? 's' : ''}`}
          {criticalCount > 0 && overdueCount > 0 && ' · '}
          {overdueCount > 0 && `${overdueCount} overdue milestone${overdueCount !== 1 ? 's' : ''}`}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-red-400 hover:text-red-600 transition-colors"
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>

      {/* Alert items */}
      <div className="border-t border-red-200 divide-y divide-red-100">
        {displayed.map((alert, i) => (
          <Link
            key={i}
            href={alert.href}
            className="block px-4 py-2 text-xs text-red-800 hover:bg-red-100 transition-colors"
          >
            {alert.text}
          </Link>
        ))}
      </div>

      {/* Show more / less */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-4 py-1.5 text-xs text-red-600 hover:bg-red-100 transition-colors border-t border-red-200"
        >
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {expanded ? 'Show less' : `+${alerts.length - 3} more items`}
        </button>
      )}
    </div>
  )
}
