'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/date-picker'
import { formatValue, formatDate } from '@/lib/utils/constants'
import type { SteelMarketingSpend } from '@/lib/supabase/types'

const inputClass = cn(
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
)

interface Props {
  spend: SteelMarketingSpend[]
  /** Channel suggestions (lead-source vocabulary in use + defaults). */
  channels: string[]
  canEdit: boolean
}

export default function SteelSpendLedger({ spend, channels, canEdit }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(spend)
  const [channel, setChannel] = useState('')
  const [amount, setAmount] = useState('')
  const [month, setMonth] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function add() {
    if (!channel.trim() || !amount.trim() || !month.trim()) {
      toast.error('Channel, amount, and month are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/steel/marketing-spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channel.trim(),
          amount: parseFloat(amount.replace(/[$,\s]/g, '')),
          spend_month: month,
          description: description.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Could not add spend.')
        return
      }
      setRows((prev) => [data.spend as SteelMarketingSpend, ...prev])
      setChannel('')
      setAmount('')
      setMonth('')
      setDescription('')
      toast.success('Spend added.')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setDeleting(id)
    try {
      const res = await fetch(`/api/steel/marketing-spend/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Could not delete.')
        return
      }
      setRows((prev) => prev.filter((r) => r.id !== id))
      router.refresh()
    } finally {
      setDeleting(null)
    }
  }

  const sorted = [...rows].sort((a, b) => (b.spend_month ?? '').localeCompare(a.spend_month ?? ''))

  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <h2 className="label-caps text-muted-foreground mb-3">Spend Ledger</h2>

      {canEdit && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-[1fr_120px_150px_1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Channel</label>
            <input
              list="spend-channels"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="e.g. Facebook Ads"
              className={inputClass}
            />
            <datalist id="spend-channels">
              {channels.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Amount ($)</label>
            <input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Month</label>
            <DatePicker name="spend_month" value={month} onChange={setMonth} />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Campaign / note"
              className={inputClass}
            />
          </div>
          <button
            onClick={add}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add
          </button>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No spend logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="font-medium pb-2 pr-3">Month</th>
                <th className="font-medium pb-2 px-3">Channel</th>
                <th className="font-medium pb-2 px-3">Description</th>
                <th className="font-medium pb-2 px-3 text-right">Amount</th>
                {canEdit && <th className="pb-2 pl-3" />}
              </tr>
            </thead>
            <tbody className="tnum">
              {sorted.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-3">{formatDate(r.spend_month)}</td>
                  <td className="py-2 px-3">{r.channel}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.description ?? '—'}</td>
                  <td className="py-2 px-3 text-right font-medium">{formatValue(r.amount)}</td>
                  {canEdit && (
                    <td className="py-2 pl-3 text-right">
                      <button
                        onClick={() => remove(r.id)}
                        disabled={deleting === r.id}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600"
                        title="Delete"
                      >
                        {deleting === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
