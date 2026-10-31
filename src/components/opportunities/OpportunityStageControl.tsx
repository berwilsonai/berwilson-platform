'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useApiCall } from '@/hooks/use-api-call'
import { OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS } from '@/lib/utils/opportunities'

interface OpportunityStageControlProps {
  opportunityId: string
  stage: string
}

/**
 * Move an opportunity along the pipeline.
 *
 * ⚠ IT WRITES `stage`, AND IT USED TO WRITE `status`. The pipeline lived in
 * `opportunities.status` until 2026-10-30; this control sent the chosen value
 * there, which after the split would have been refused outright by
 * `opportunities_status_check` — a 500 on every single stage change, from a
 * control whose own optimistic update made the screen look like it had worked
 * until the toast arrived. The field name is the whole fix.
 */
export default function OpportunityStageControl({ opportunityId, stage }: OpportunityStageControlProps) {
  const { busy, call } = useApiCall()
  const [value, setValue] = useState(stage)

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
    const ok = await call('stage', `/api/opportunities/${opportunityId}`, 'PATCH', { stage: next })
    if (!ok) setValue(previous)
  }

  const saving = busy === 'stage'

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        aria-label="Opportunity stage"
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {OPPORTUNITY_STAGES.map((s) => (
          <option key={s} value={s}>
            {OPPORTUNITY_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
    </div>
  )
}
