'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABELS } from '@/lib/utils/opportunities'

interface OpportunityStatusControlProps {
  opportunityId: string
  status: string
}

export default function OpportunityStatusControl({ opportunityId, status }: OpportunityStatusControlProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [value, setValue] = useState(status)

  async function change(next: string) {
    setValue(next)
    setSaving(true)
    try {
      await fetch(`/api/opportunities/${opportunityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
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
