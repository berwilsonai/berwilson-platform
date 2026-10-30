'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils/constants'
import { driftLabel, type SectionSignoff as Signoff } from '@/lib/dataroom/signoff'

/**
 * The checkbox beside one data-room section.
 *
 * Ticking it means a person has looked at this shelf and confirms what is in it
 * is the right, current set — Richard's *"a human adjudicated it and verified
 * that is the most accurate and up to date doc"*. The row that results records
 * who and when, plus a fingerprint of the documents they were looking at.
 *
 * ⚠ A STALE TICK STAYS TICKED AND SAYS SO. When the document set changes the
 * sign-off has not become false, it has become out of date, and those are
 * different things: clearing it would lose who looked, keeping it silently
 * would let the room read verified while documents landed unexamined. So the
 * box keeps its mark, takes a caution tone, and carries the drift in words.
 *
 * ⚠ THE TWO SIGNALS ARE IN DIFFERENT UTILITY GROUPS ON PURPOSE. `cn()` is
 * tailwind-merge, so a stale tint and a checked fill both written as `bg-*`
 * would silently delete one another (§12, which cost the most urgent row its
 * colour). Checked is the fill, stale is the RING.
 */
export default function SectionSignoff({
  recordKind,
  recordId,
  sectionKey,
  sectionLabel,
  signoff,
  canSign,
}: {
  recordKind: 'project' | 'opportunity'
  recordId: string
  sectionKey: string
  sectionLabel: string
  signoff: Signoff | null
  canSign: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const checked = !!signoff
  const stale = !!signoff?.stale
  const drift = signoff ? driftLabel(signoff) : null

  async function toggle() {
    if (!canSign || busy) return
    setBusy(true)
    try {
      const body =
        recordKind === 'project'
          ? { project_id: recordId, section_key: sectionKey }
          : { opportunity_id: recordId, section_key: sectionKey }
      const res = await fetch('/api/dataroom/signoff', {
        // Un-tick only when it is fresh. A STALE tick's button re-confirms:
        // that is the action somebody actually wants there, and making the
        // obvious press destroy the record of who last looked would be the
        // wrong default.
        method: checked && !stale ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; by?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'That did not save.')
        return
      }
      toast.success(
        checked && !stale
          ? `${sectionLabel} un-ticked.`
          : `${sectionLabel} signed off${data.by ? ` by ${data.by}` : ''}.`
      )
      // ⚠ The completion count is server-rendered, so without this it keeps
      // the old figure until the tab is reloaded (§12: an optimistic client
      // mutation with no router.refresh() leaves every server-rendered count
      // lying).
      router.refresh()
    } catch {
      toast.error('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const label = checked
    ? stale
      ? `${sectionLabel}: signed off by ${signoff?.by ?? 'someone'}, but the documents have changed — re-confirm`
      : `${sectionLabel}: signed off by ${signoff?.by ?? 'someone'} — un-tick`
    : `${sectionLabel}: mark as verified and up to date`

  return (
    <div className="flex items-start gap-2.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!canSign || busy}
        aria-pressed={checked}
        aria-label={label}
        title={label}
        className={cn(
          // Written absolutely, not as a density-derived `h-*`: §12 — `h-11` is
          // `calc(var(--spacing) * 11)` and a tightened token took 66 tap
          // targets below the 44px floor with nothing reporting it.
          'mt-0.5 grid size-[1.375rem] shrink-0 place-items-center rounded-[0.3rem] border transition-colors',
          'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          checked
            ? 'bg-foreground border-foreground text-background'
            : 'border-input bg-background hover:bg-accent',
          // The RING, not a background — see the note above about tailwind-merge.
          stale && 'ring-2 ring-caution',
          !canSign && 'cursor-not-allowed opacity-50'
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : checked ? (
          <Check className="size-3.5" strokeWidth={3} />
        ) : null}
      </button>

      {checked ? (
        <div className="min-w-0 text-xs leading-tight">
          <p className={cn(stale ? 'text-caution' : 'text-muted-foreground')}>
            {stale ? (
              <TriangleAlert className="mr-1 inline size-3 -mt-0.5" />
            ) : (
              <Check className="mr-1 inline size-3 -mt-0.5" />
            )}
            {signoff?.by ?? 'Signed off'}
            {signoff?.at ? ` · ${formatDate(signoff.at)}` : null}
          </p>
          {drift ? <p className="mt-0.5 text-caution">{drift}</p> : null}
          {signoff?.note ? (
            <p className="mt-0.5 text-muted-foreground">{signoff.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
