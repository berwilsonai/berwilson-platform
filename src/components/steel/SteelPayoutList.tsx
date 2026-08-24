'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, Loader2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import { PAID_FIELD, PAYOUT_LABELS, type PayoutItem } from '@/lib/steel/rollups'

export type { PayoutItem }

async function setPaid(item: PayoutItem, paid: boolean): Promise<boolean> {
  const res = await fetch(`/api/steel/deals/${item.dealId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [PAID_FIELD[item.kind]]: paid }),
  })
  return res.ok
}

export default function SteelPayoutList({ items }: { items: PayoutItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const outstanding = items.filter((i) => !i.paid)
  const paid = items.filter((i) => i.paid)

  // Group outstanding by person.
  const groups = new Map<string, PayoutItem[]>()
  for (const i of outstanding) {
    const list = groups.get(i.personName) ?? []
    list.push(i)
    groups.set(i.personName, list)
  }
  const groupList = [...groups.entries()]
    .map(([person, list]) => ({ person, list, total: list.reduce((a, i) => a + i.amount, 0) }))
    .sort((a, b) => b.total - a.total)

  const totalOwed = outstanding.reduce((a, i) => a + i.amount, 0)

  async function mark(itemsToMark: PayoutItem[], paidValue: boolean, busyKey: string) {
    setBusy(busyKey)
    try {
      const results = await Promise.all(itemsToMark.map((i) => setPaid(i, paidValue)))
      if (results.some((r) => !r)) toast.error('Some updates failed')
      else toast.success(paidValue ? 'Marked paid' : 'Marked unpaid')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label-caps text-muted-foreground">Outstanding Payouts</h2>
        {totalOwed > 0 && (
          <span className="text-sm font-semibold tnum">{formatValue(totalOwed)} owed</span>
        )}
      </div>

      {groupList.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Nothing outstanding — all commissions are paid.</p>
      ) : (
        <div className="space-y-4">
          {groupList.map(({ person, list, total }) => (
            <div key={person} className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{person}</p>
                  <p className="text-[11px] text-muted-foreground tnum">
                    {list.length} item{list.length !== 1 ? 's' : ''} · {formatValue(total)}
                  </p>
                </div>
                <button
                  disabled={busy !== null}
                  onClick={() => mark(list, true, `group:${person}`)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
                >
                  {busy === `group:${person}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Pay all
                </button>
              </div>
              <ul className="divide-y divide-border">
                {list.map((i) => (
                  <li key={i.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/steel/${i.dealId}`} className="text-sm font-medium hover:underline truncate block">
                        {i.dealName}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">{PAYOUT_LABELS[i.kind]}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium tnum">{formatValue(i.amount)}</span>
                      <button
                        disabled={busy !== null}
                        onClick={() => mark([i], true, i.key)}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        {busy === i.key ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        Mark paid
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Recently paid — undo */}
      {paid.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Paid ({paid.length}) · {formatValue(paid.reduce((a, i) => a + i.amount, 0))}
          </summary>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {paid.map((i) => (
              <li key={i.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <Link href={`/steel/${i.dealId}`} className="text-sm hover:underline truncate block">
                    {i.dealName}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    {i.personName} · {PAYOUT_LABELS[i.kind]}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn('text-sm tnum text-muted-foreground')}>{formatValue(i.amount)}</span>
                  <button
                    disabled={busy !== null}
                    onClick={() => mark([i], false, i.key)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {busy === i.key ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                    Undo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
