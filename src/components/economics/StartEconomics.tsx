'use client'

/**
 * The offer shown on a deal that has no economics model.
 *
 * ⚠ IT DOES NOT CREATE AN EMPTY MODEL ON PAGE LOAD. A model that appears
 * because someone opened a tab would publish a capture of null and read, on
 * the pipeline, as a deal somebody has looked at and priced at nothing. The
 * model exists because a person decided to make one.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { RecordKind } from '@/lib/records/scope'

interface StartEconomicsProps {
  recordKind: RecordKind
  recordId: string
  recordName: string
  canEdit: boolean
}

export default function StartEconomics({
  recordKind,
  recordId,
  recordName,
  canEdit,
}: StartEconomicsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      const res = await fetch('/api/economics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          recordKind === 'project' ? { project_id: recordId } : { opportunity_id: recordId }
        ),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(payload.error ?? 'Could not start a model')
        return
      }
      router.refresh()
    } catch {
      toast.error('Could not start a model')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="p-5 sm:p-6">
      <h2 className="text-base font-medium">No economics model for {recordName} yet</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        A model answers two questions that this platform currently cannot: how big is this deal,
        and how much of it is Ber Wilson&apos;s. It keeps every megawatt accounted for from source
        to use, keeps annual revenue, contract value, build value and asset value apart, and
        records where every number came from so a planning figure never reads as a commitment.
      </p>
      <ul className="mt-3 max-w-prose list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Nothing is assumed. No price, rate, term or discount rate has a default.</li>
        <li>
          Starting a model publishes no figure. The pipeline only changes once the model computes
          without anything blocking it.
        </li>
      </ul>
      {canEdit ? (
        <Button className="mt-4" onClick={start} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Start a model
        </Button>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          You can read this deal but not model it.
        </p>
      )}
    </Panel>
  )
}
