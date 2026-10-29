'use client'

import { useMemo, useState } from 'react'
import { OPERATION_PRESENTATION } from '@/lib/jobs/operations'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { cn } from '@/lib/utils'

export interface ReviewRow {
  index: number
  kind: string
  description: string
  evidence: string | null
}

/*
  ⚠ DERIVED FROM THE VOCABULARY, NOT WRITTEN OUT. These were two hand-written
  maps keyed by `string`, each falling back to the raw token — so a verb added
  to `operations.ts` got a count and a chip reading `link_thread`, and nothing
  failed. §12 records this exact drift being fixed in /decide's count map and
  then repeated in its chip row, and again in the Documents tab. The registry
  is typed `Record<JobOperationKind, …>`, so the next verb fails the build
  until it has a label.
*/
const KIND_TONE = Object.fromEntries(
  Object.entries(OPERATION_PRESENTATION).map(([k, v]) => [k, v.tone])
) as Record<string, string>

const KIND_LABEL = Object.fromEntries(
  Object.entries(OPERATION_PRESENTATION).map(([k, v]) => [k, v.label])
) as Record<string, string>

/**
 * Tick what actually happens.
 *
 * ⚠ EVERYTHING STARTS TICKED, AND THAT IS A CONSIDERED CHOICE RATHER THAN A
 * DEFAULT. The reviewer asked for this work; making them tick 232 boxes to get
 * what they asked for is the surface that nobody uses. What protects them is
 * that nothing happens until they press, that every row says what it will do in
 * words, and that untick-all is one press away.
 *
 * ⚠ The REQUEST still sends an explicit list. An empty selection means nothing
 * happens — the route refuses to read a missing selection as "all of them".
 */
export default function OperationReview({
  jobId,
  rows,
}: {
  jobId: string
  rows: ReviewRow[]
}) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<number>>(() => new Set(rows.map((r) => r.index)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byKind = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
    return [...counts.entries()]
  }, [rows])

  function toggle(index: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobs/${jobId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: [...picked] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The apply failed.')
      // A server-rendered page shows the outcome; without this the counts on it
      // keep reading the pre-apply numbers until the tab is reloaded (§12).
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The apply failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="label-caps text-muted-foreground">
          {rows.length} proposed
        </p>
        {byKind.map(([kind, n]) => (
          <Chip key={kind} tone={KIND_TONE[kind] ?? 'neutral'}>
            {KIND_LABEL[kind] ?? kind} {n}
          </Chip>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(rows.map((r) => r.index)))} disabled={busy}>
          All
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={busy}>
          None
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((r) => {
          const on = picked.has(r.index)
          return (
            <li key={r.index}>
              <label
                className={cn(
                  'flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors',
                  // ⚠ The tick state uses a RING, not a background: `cn()` is
                  // tailwind-merge, so a second `bg-*` would silently delete the
                  // hover one and the row would lose its highlight exactly when
                  // you moved onto it (§12).
                  on ? 'ring-1 ring-inset ring-info-edge' : 'opacity-60',
                  'hover:bg-muted'
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(r.index)}
                  disabled={busy}
                  className="mt-0.5 size-4 shrink-0 accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm text-foreground">{r.description}</span>
                  {r.evidence && (
                    <span className="block text-xs text-muted-foreground">{r.evidence}</span>
                  )}
                </span>
                <Chip tone={KIND_TONE[r.kind] ?? 'neutral'} className="shrink-0">
                  {KIND_LABEL[r.kind] ?? r.kind}
                </Chip>
              </label>
            </li>
          )
        })}
      </ul>

      {error && <p className="text-sm text-critical">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={apply} disabled={busy || picked.size === 0}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {busy ? 'Applying…' : picked.size === rows.length
            ? `Apply all ${rows.length}`
            : `Apply ${picked.size} of ${rows.length}`}
        </Button>
        {picked.size === 0 && (
          <p className="text-xs text-muted-foreground">Nothing ticked — nothing will happen.</p>
        )}
      </div>
    </div>
  )
}
