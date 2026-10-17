'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useApiCall } from '@/hooks/use-api-call'
import { INVESTOR_STAGES, INVESTOR_STAGE_LABELS } from '@/lib/utils/investors'

interface InvestorStageControlProps {
  investorId: string
  stage: string
}

export default function InvestorStageControl({ investorId, stage }: InvestorStageControlProps) {
  const { busy, call } = useApiCall()
  const [value, setValue] = useState(stage)

  /**
   * Optimistic, and reverted when the save fails — see the note in
   * OpportunityStatusControl, which is the same control over a different
   * column. A relationship stage that only LOOKS advanced is worse than one
   * that visibly refused to move.
   */
  async function change(next: string) {
    const previous = value
    setValue(next)
    const ok = await call('stage', `/api/investors/${investorId}`, 'PATCH', { stage: next })
    if (!ok) setValue(previous)
  }

  const saving = busy === 'stage'

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        aria-label="Investor stage"
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {INVESTOR_STAGES.map((s) => (
          <option key={s} value={s}>
            {INVESTOR_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
    </div>
  )
}
