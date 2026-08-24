'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { STEEL_STAGES, STEEL_STAGE_LABELS } from '@/lib/utils/steel'

interface SteelStageControlProps {
  dealId: string
  stage: string
}

export default function SteelStageControl({ dealId, stage }: SteelStageControlProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [value, setValue] = useState(stage)

  async function change(next: string) {
    const prev = value
    setValue(next)
    setSaving(true)
    try {
      const res = await fetch(`/api/steel/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
      })
      if (!res.ok) {
        // Revert the optimistic change so the dropdown can't drift from the DB.
        setValue(prev)
        const { error } = await res.json().catch(() => ({ error: 'Failed to update stage' }))
        toast.error(error ?? 'Failed to update stage')
        return
      }
      router.refresh()
    } catch {
      setValue(prev)
      toast.error('Failed to update stage')
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
        {STEEL_STAGES.map((s) => (
          <option key={s} value={s}>
            {STEEL_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
    </div>
  )
}
