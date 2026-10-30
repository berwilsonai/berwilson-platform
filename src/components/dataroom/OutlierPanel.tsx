'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, ExternalLink, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/card'
import { formatDate } from '@/lib/utils/constants'
import {
  OUTLIER_HINTS,
  OUTLIER_LABELS,
  type MirrorStatus,
  type Outlier,
  type OutlierReason,
} from '@/lib/dataroom/mirror'
import type { Tone } from '@/lib/ui/tone'

/**
 * Outliers — what this record holds that Drive does not currently back.
 *
 * Richard, 2026-10-30: *"The drive will really be the source of truth… Any
 * folders that dont match the drive are pushed out into an area where they can
 * be deleted or kept separately. This will allow for better data hygiene."*
 *
 * ONE area, as asked. But the reason travels with every row and the actions
 * differ, because the reasons are not interchangeable:
 *
 *   - a DUPLICATE's bytes live in the copy that was kept, so deleting it costs
 *     nothing and this is the group worth clearing;
 *   - a document that was NEVER in Drive may be the only copy in existence — a
 *     mail attachment the platform extracted, or a note Ber AI wrote. Deleting
 *     that is destruction dressed as hygiene.
 *
 * ⚠ SO THE ONLY-COPY ROWS DO NOT GET THE SAME BUTTON. They carry a warning and
 * their delete asks for a second press. §12: a queue whose every row gets the
 * same buttons has not classified anything — let the class decide which actions
 * exist. The platform has no business offering an identical one-click beside a
 * duplicate where deleting is free and a sole surviving attachment where it is
 * not.
 */

const TONE: Record<OutlierReason, Tone> = {
  duplicate: 'neutral',
  excluded: 'neutral',
  retired_by_hand: 'neutral',
  gone_from_drive: 'caution',
  never_in_drive: 'caution',
}

/** Duplicates first — the group with real deletions behind it. */
const ORDER: OutlierReason[] = [
  'duplicate',
  'never_in_drive',
  'gone_from_drive',
  'retired_by_hand',
  'excluded',
]

function Row({
  outlier,
  kind,
  onGone,
}: {
  outlier: Outlier
  kind: 'project' | 'opportunity'
  onGone: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)

  async function remove() {
    // ⚠ The only-copy rows need two presses. The first arms, the second acts —
    // and the label changes so the second press is a different sentence, not
    // the same one again.
    if (outlier.onlyCopy && !armed) {
      setArmed(true)
      return
    }
    setBusy(true)
    try {
      const res = await fetch(
        `/api/documents/${outlier.id}?source=${kind === 'project' ? 'documents' : 'opportunity_documents'}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error ?? 'That did not delete.')
        return
      }
      toast.success(`${outlier.fileName} deleted from Ber Intelligence.`)
      onGone(outlier.id)
    } catch {
      toast.error('Could not reach the server.')
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{outlier.fileName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[
            outlier.drivePath ?? 'no Drive folder',
            outlier.uploadedAt ? formatDate(outlier.uploadedAt) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {outlier.keptInstead ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            kept instead:{' '}
            <span className="text-foreground">{outlier.keptInstead.fileName}</span>
            {outlier.keptInstead.drivePath ? (
              <span className="text-muted-foreground"> in {outlier.keptInstead.drivePath}</span>
            ) : null}
          </p>
        ) : null}
        {outlier.onlyCopy ? (
          <p className="mt-1 text-xs text-caution">
            <TriangleAlert className="mr-1 inline size-3 -mt-0.5" />
            This is the only copy — nothing in Drive holds it.
          </p>
        ) : null}
      </div>

      {outlier.driveFileId ? (
        <a
          href={`https://drive.google.com/file/d/${outlier.driveFileId}/view`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Drive <ExternalLink className="inline size-3" />
        </a>
      ) : null}

      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className={cn(
          'inline-flex h-[2rem] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          armed
            ? 'bg-critical text-primary-foreground'
            : 'border border-input bg-background hover:bg-accent'
        )}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
        {armed ? 'Really delete?' : 'Delete'}
      </button>
    </li>
  )
}

export default function OutlierPanel({ mirror }: { mirror: MirrorStatus }) {
  const router = useRouter()
  const [gone, setGone] = useState<Set<string>>(new Set())

  const live = mirror.outliers.filter((o) => !gone.has(o.id))
  if (live.length === 0 && gone.size === 0) return null

  function onGone(id: string) {
    setGone((s) => new Set(s).add(id))
    // ⚠ The counts above are server-rendered, so without this they keep the old
    // figure until the tab is reloaded. Debounced on the trailing edge would be
    // better for a bulk clear-out; one at a time, this is correct and cheap.
    router.refresh()
  }

  const groups = ORDER.map((reason) => ({
    reason,
    rows: live.filter((o) => o.reason === reason),
  })).filter((g) => g.rows.length > 0)

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <h2 className="label-caps text-muted-foreground">Outliers</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drive is the source of truth. These {live.length} are things Ber Intelligence holds
            that Drive does not currently back — keep them, or clear them out.
          </p>
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {mirror.mirrored} mirrored
        </p>
      </div>

      <div className="divide-y divide-border">
        {groups.map((group, i) => (
          <details key={group.reason} open={i === 0}>
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent/50">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform [details[open]_&]:rotate-90" />
              <Chip tone={TONE[group.reason]}>{OUTLIER_LABELS[group.reason]}</Chip>
              <span className="text-muted-foreground tabular-nums">{group.rows.length}</span>
            </summary>
            <p className="px-4 pb-2 pl-11 text-xs text-muted-foreground">
              {OUTLIER_HINTS[group.reason]}
            </p>
            <ul className="divide-y divide-border border-t border-border">
              {group.rows.map((o) => (
                <Row key={o.id} outlier={o} kind={mirror.kind} onGone={onGone} />
              ))}
            </ul>
          </details>
        ))}
      </div>

      {gone.size > 0 ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {gone.size} deleted this visit.
        </p>
      ) : null}
    </Panel>
  )
}
