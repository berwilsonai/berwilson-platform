'use client'

/**
 * What the AI found in this deal's documents, waiting on a human.
 *
 * ⚠ THE QUOTE IS THE POINT OF THIS SCREEN. A reader accepts or rejects by
 * reading the sentence the figure came from, not by trusting a confidence
 * score. A proposal whose quote does not support its figure is the one thing
 * this panel exists to catch, so the quote is rendered at full size and the
 * figure sits beside it.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { REVENUE_LINE_LABELS, type RevenueLineType } from '@/lib/economics'

export interface ProposalView {
  id: string
  field_key: string
  proposed_value: number | string | null
  proposed_unit: string | null
  proposed_line_type: string | null
  proposed_label: string | null
  source_quote: string | null
  confidence: number | null
  reasoning: string | null
}

interface ProposalsPanelProps {
  economicsId: string
  proposals: ProposalView[]
  documentCount: number
}

function figure(p: ProposalView): string {
  const value = p.proposed_value == null ? null : Number(p.proposed_value)
  if (value == null || !Number.isFinite(value)) return 'no figure'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}${
    p.proposed_unit ? ` ${p.proposed_unit}` : ''
  }`
}

export default function ProposalsPanel({
  economicsId,
  proposals,
  documentCount,
}: ProposalsPanelProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  async function decide(id: string, decision: 'accepted' | 'rejected') {
    setBusy(id)
    try {
      const res = await fetch(`/api/economics/${economicsId}/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(payload.error ?? 'That did not save')
        return
      }
      toast.success(decision === 'accepted' ? 'Accepted, with its source' : 'Rejected')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function extract() {
    setExtracting(true)
    // Said up front: the local model is 30 to 60 seconds a slice and serves one
    // request at a time, so silence here would read as a hang.
    toast.info('Reading the documents. This takes a few minutes on a long proposal.')
    try {
      const res = await fetch(`/api/economics/${economicsId}/extract`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        result?: {
          documentsRead: number
          proposalsCreated: number
          figuresDiscarded: number
          notes: string[]
        }
      }
      if (!res.ok) {
        toast.error(payload.error ?? 'The pass failed')
        return
      }
      const r = payload.result
      if (!r) return
      // A coverage count with its reasons. "0 proposals" from 0 documents and
      // "0 proposals" from 6 documents are different outcomes.
      toast.success(
        r.proposalsCreated > 0
          ? `${r.proposalsCreated} figure(s) proposed from ${r.documentsRead} document(s)`
          : `Read ${r.documentsRead} document(s) and found no deal figures in them`
      )
      if (r.figuresDiscarded > 0) {
        toast.warning(
          `${r.figuresDiscarded} figure(s) were discarded: no quote, no recognised field, or nothing readable.`
        )
      }
      router.refresh()
    } finally {
      setExtracting(false)
    }
  }

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="label-caps text-muted-foreground">Read from the documents</h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Ber AI proposes figures and never writes one. Every proposal carries the sentence it
            came from, which is how you check it in two seconds. Accepting records the figure and
            its source together.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={extract} disabled={extracting || documentCount === 0}>
          {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {proposals.length > 0 ? 'Read them again' : 'Read the documents'}
        </Button>
      </div>

      {documentCount === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          This deal has no documents with readable text yet, so there is nothing to read.
        </p>
      ) : null}

      {proposals.length === 0 ? (
        documentCount > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing is waiting on you. {documentCount} document
            {documentCount === 1 ? '' : 's'} can be read for figures.
          </p>
        ) : null
      ) : (
        <ul className="mt-4 space-y-3">
          {proposals.map((p) => (
            <li key={p.id} className="rounded-md bg-muted/30 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{p.proposed_label ?? p.field_key}</span>
                <span className="tnum text-sm font-semibold">{figure(p)}</span>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {p.proposed_line_type ? (
                  <Chip className="bg-muted text-muted-foreground">
                    {REVENUE_LINE_LABELS[p.proposed_line_type as RevenueLineType] ??
                      p.proposed_line_type}
                  </Chip>
                ) : null}
                <span className="font-mono">{p.field_key}</span>
                {p.confidence != null ? <span>{' · '}confidence {p.confidence}</span> : null}
              </p>

              {p.source_quote ? (
                <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm italic">
                  {p.source_quote}
                </blockquote>
              ) : null}
              {p.reasoning ? (
                <p className="mt-2 text-[11px] text-muted-foreground">{p.reasoning}</p>
              ) : null}

              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={busy === p.id} onClick={() => void decide(p.id, 'accepted')}>
                  {busy === p.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === p.id}
                  onClick={() => void decide(p.id, 'rejected')}
                >
                  <X className="size-4" />
                  Reject
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Accepting adds it as a line that is NOT marked as Ber Wilson revenue. On these
                deals most of the gross is a partner&apos;s, so that is the safe default to correct
                rather than the other way round.
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
