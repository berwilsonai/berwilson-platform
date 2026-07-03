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
  const [confirmDismiss, setConfirmDismiss] = useState(false)

  if (dismissed || alerts.length === 0) return null

  const criticalCount = alerts.filter(a => a.type === 'critical').length
  const overdueCount = alerts.filter(a => a.type === 'overdue').length

  const displayed = expanded ? alerts : alerts.slice(0, 3)
  const hasMore = alerts.length > 3

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 elev-1 overflow-hidden">
      {/* Dismiss confirmation */}
      {confirmDismiss && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800/60">
          <span className="text-xs text-red-800 dark:text-red-300 flex-1">
            Dismiss all {alerts.length} alerts for this session?
          </span>
          <button
            onClick={() => setConfirmDismiss(false)}
            className="h-6 px-2 rounded text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <AlertTriangle size={14} className="text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
        <span className="text-xs font-semibold text-red-800 dark:text-red-300 flex-1">
          {criticalCount > 0 && `${criticalCount} critical item${criticalCount !== 1 ? 's' : ''}`}
          {criticalCount > 0 && overdueCount > 0 && ' · '}
          {overdueCount > 0 && `${overdueCount} overdue milestone${overdueCount !== 1 ? 's' : ''}`}
        </span>
        <button
          onClick={() => setConfirmDismiss(true)}
          className="p-1 text-red-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          aria-label="Dismiss alerts"
        >
          <X size={12} />
        </button>
      </div>

      {/* Alert items */}
      <div className="border-t border-red-200 dark:border-red-800/60 divide-y divide-red-100 dark:divide-red-800/60">
        {displayed.map((alert, i) => (
          <Link
            key={i}
            href={alert.href}
            className="block px-4 py-2 text-xs text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          >
            {alert.text}
          </Link>
        ))}
      </div>

      {/* Show more / less */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-4 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors border-t border-red-200 dark:border-red-800/60"
        >
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {expanded ? 'Show less' : `+${alerts.length - 3} more items`}
        </button>
      )}
    </div>
  )
}
