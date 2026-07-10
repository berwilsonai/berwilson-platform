'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { INVESTOR_STAGES, INVESTOR_STAGE_LABELS } from '@/lib/utils/investors'

interface InvestorStageControlProps {
  investorId: string
  stage: string
}

export default function InvestorStageControl({ investorId, stage }: InvestorStageControlProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [value, setValue] = useState(stage)

  async function change(next: string) {
    setValue(next)
    setSaving(true)
    try {
      await fetch(`/api/investors/${investorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
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
