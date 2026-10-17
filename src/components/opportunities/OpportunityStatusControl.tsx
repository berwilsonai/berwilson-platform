'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useApiCall } from '@/hooks/use-api-call'
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABELS } from '@/lib/utils/opportunities'

interface OpportunityStatusControlProps {
  opportunityId: string
  status: string
}

export default function OpportunityStatusControl({ opportunityId, status }: OpportunityStatusControlProps) {
  const { busy, call } = useApiCall()
  const [value, setValue] = useState(status)

  /**
   * The select shows the new status before the server has agreed to it, which
   * is right — the round trip is slow enough that waiting feels broken. But an
   * optimistic control MUST put the old value back when the save fails, or the
   * screen keeps asserting something the database never accepted. `call`
   * reports that, and raises the route's own error sentence as a toast.
   */
  async function change(next: string) {
    const previous = value
    setValue(next)
    const ok = await call('status', `/api/opportunities/${opportunityId}`, 'PATCH', { status: next })
    if (!ok) setValue(previous)
  }

  const saving = busy === 'status'

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        aria-label="Opportunity status"
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {OPPORTUNITY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {OPPORTUNITY_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
    </div>
  )
}
