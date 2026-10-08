'use client'

/**
 * "Fold duplicate proposals" — the door onto `dedupePendingSessions`.
 *
 * The queue proposes one record per CLUSTER OF CORRESPONDENCE, not one per
 * deal, so a long-running programme arrives as many proposals. Measured
 * 2026-10-08 on the live backlog: ten proposals about Steelton, six about
 * Myton, five about Zenthium, out of 109 marked `create`. Confirming them as
 * they stand creates ten Steelton projects.
 *
 * TWO STEPS ON PURPOSE. A wrong merge is the one outcome in this pass with no
 * undo, so the first press only PLANS — it reports what would be folded and
 * changes nothing — and applying is a second, deliberate press. Both are long:
 * the grouping is one model call over every pending proposal, and each group
 * then costs a re-analysis. The label says so rather than leaving the reader to
 * wonder whether it has hung.
 *
 * ⚠ AND THE PLAN IS AN ESTIMATE, WHICH THE SCREEN HAS TO SAY. Two dry runs over
 * the same backlog returned 6 groups of ~5 and then 11 groups of ~2: the model
 * reads summaries and is not deterministic about how coarse a programme is.
 * Applying re-groups rather than replaying the plan — there is no stored plan to
 * replay, and pretending otherwise would promise a number the pass will not
 * honour. So the plan answers "is there duplication worth folding", which is the
 * question being asked, and never "these exact rows".
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface DedupeProgress {
  candidates: number
  groups: number
  merged: number
  folded: number
  failed: number
  heldBack: string[]
  errors: string[]
  outOfTime: boolean
  dryRun: boolean
}

export default function DedupeProposalsButton({ pending }: { pending: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null)
  const [plan, setPlan] = useState<DedupeProgress | null>(null)

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'plan' : 'apply')
    try {
      const res = await fetch('/api/email-ingestion/dedupe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      })
      const data = (await res.json()) as DedupeProgress & { error?: string }
      if (!res.ok) throw new Error(data.error || 'The grouping pass failed.')

      if (dryRun) {
        setPlan(data)
        if (data.merged === 0) toast.success('Nothing to fold — no two proposals describe the same deal.')
      } else {
        setPlan(null)
        toast.success(
          data.folded > 0
            ? `Folded ${data.folded} duplicate${data.folded === 1 ? '' : 's'} into ${data.merged} deal${data.merged === 1 ? '' : 's'}.`
            : 'Nothing was folded.'
        )
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The grouping pass failed.')
    } finally {
      setBusy(null)
    }
  }

  // Below two proposals there is nothing a grouping could say.
  if (pending < 2) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Fold duplicate proposals</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pending} proposals are waiting. Several usually describe one deal — correspondence
            about the same programme arrives as separate clusters. Ber AI groups them by what the
            mail is about, then the fullest proposal absorbs the others&apos; correspondence and the
            rest are let go pointing at it. Nothing is created and no record is touched.
          </p>
        </div>
        <Layers size={16} className="text-muted-foreground shrink-0 mt-0.5" />
      </div>

      {plan && (
        <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1.5 text-xs">
          {plan.merged > 0 ? (
            <>
              <p className="font-medium text-foreground">
                About {plan.folded} of {plan.candidates} proposals look like duplicates —
                this trial grouped them into {plan.merged} deal
                {plan.merged === 1 ? '' : 's'}, leaving {plan.candidates - plan.folded} to
                review.
              </p>
              <p className="text-muted-foreground">
                A figure, not a list: folding re-reads the queue, and the grouping varies a
                little between runs on how coarse a programme is.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Read {plan.candidates} proposals and found no two about the same deal.
            </p>
          )}
          {plan.heldBack.map((h, i) => (
            <p key={i} className="text-muted-foreground">{h}</p>
          ))}
          {plan.outOfTime && (
            <p className="text-muted-foreground">
              The pass ran out of time — run it again to continue.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => run(true)} disabled={busy !== null}>
          {busy === 'plan' ? <Loader2 className="animate-spin" /> : <Layers />}
          {plan ? 'Re-check' : 'Show me what would fold'}
        </Button>
        {plan && plan.merged > 0 && (
          <Button size="sm" onClick={() => run(false)} disabled={busy !== null}>
            {busy === 'apply' && <Loader2 className="animate-spin" />}
            Fold them
          </Button>
        )}
        {busy && (
          <span className="text-xs text-muted-foreground">
            {busy === 'plan'
              ? 'Reading every proposal in one pass — several minutes.'
              : 'Re-reading each group’s correspondence — a minute per deal.'}
          </span>
        )}
      </div>
    </div>
  )
}
