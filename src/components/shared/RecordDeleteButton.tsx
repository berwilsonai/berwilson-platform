'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

/**
 * Delete one top-level record, from a list row or from its own detail page.
 *
 * ⚠ THIS EXISTS BECAUSE IT WAS ALREADY WRITTEN TWICE. `OpportunityDeleteButton`
 * and `InvestorDeleteButton` were the same 60 lines differing in four strings —
 * the endpoint, the noun, the redirect and one sentence of description — and
 * §12's hardest fork to see is exactly that: two sibling modules written days
 * apart, where neither looks like a copy because every identifier was renamed.
 * Adding a row delete to both lists would have made it four copies. Both of
 * those files are gone; this is the one they became, with a target parameter.
 *
 * ⚠ IT OWNS NO ROUTER, AND THAT IS WHAT MAKES IT VERIFIABLE. `useRouter` throws
 * "invariant expected app router to be mounted" outside a Next request, so a
 * component that reads it cannot be exercised by `renderToStaticMarkup` — and
 * §12 is explicit that a listed route is not an answering one and a curl behind
 * auth cannot tell you which. The caller says what happens afterwards via
 * `onDeleted`: a list removes the card optimistically, and a detail page uses
 * `RecordDeleteAndLeave`, which is the one place a router is needed.
 *
 * ── THE TWO VARIANTS ─────────────────────────────────────────────────────────
 *
 * `pill` is the labelled button a detail page's header carries.
 *
 * `card` is the corner icon on a card in a grid, positioned absolutely by the
 * caller's `relative group/card` wrapper. ⚠ IT MUST BE A SIBLING OF THE CARD'S
 * `<Link>`, NEVER A CHILD OF IT: a `<button>` inside an `<a>` is invalid HTML
 * and browsers resolve it by firing BOTH, so the first press would navigate
 * away mid-request with `tsc`, the build and a glance all clean. That is why
 * every handler here also calls `preventDefault()` — the wrapper is not the
 * anchor, but a card that grows a second overlay later would re-create the bug
 * and this is cheap insurance against it.
 */

export interface RecordDeleteTarget {
  /** The route that owns this row. DELETE goes here; its own guard applies. */
  endpoint: string
  /** What the reader calls the thing: "opportunity", "investor". */
  noun: string
  /** The record's own name, for the confirmation that names it before it goes. */
  name: string
  /**
   * What else goes with it, in words. Per record type on purpose — an
   * opportunity takes its documents and an investor takes its investments and
   * notes while leaving the directory contact, and a generic sentence covering
   * both would be true of neither.
   */
  description: string
}

export default function RecordDeleteButton({
  target,
  variant = 'pill',
  onDeleted,
  className,
}: {
  target: RecordDeleteTarget
  variant?: 'pill' | 'card'
  /**
   * Called once the server has confirmed the delete. The caller decides what
   * that means — removing a card, or leaving the page.
   */
  onDeleted: () => void
  className?: string
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(target.endpoint, { method: 'DELETE' })
      if (!res.ok) {
        // The routes behind this are admin-only and answer with a sentence a
        // reader can act on ("Only admins can delete opportunities"), so it is
        // shown rather than replaced with a generic failure.
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(error ?? `Could not delete that ${target.noun}.`)
        setDeleting(false)
        return
      }
      toast.success(`${target.noun[0].toUpperCase()}${target.noun.slice(1)} deleted`)
      onDeleted()
    } catch {
      toast.error(`Could not delete that ${target.noun}.`)
      setDeleting(false)
    }
  }

  return (
    <>
      {variant === 'pill' ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-input bg-background text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-destructive hover:border-destructive/40 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
            className
          )}
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Delete
        </button>
      ) : (
        /*
          ⚠ VISIBLE BELOW `sm`, HOVER-REVEALED ABOVE IT, AND ALWAYS ON FOCUS.
          §12: a control that only appears on hover does not exist on a phone,
          and one without a focus reveal is invisible to a keyboard user. The
          group is named (`group/card`) because these cards already sit inside
          other groups.

          ⚠ AND THE TAP TARGET IS WRITTEN ABSOLUTELY. `size-11` is
          `calc(var(--spacing) * 11)` — 44px at the default and 38.7px once the
          10-17 redraw tightened spacing, which took 66 targets below the floor
          in 32 files with nothing reporting it. The icon stays 13px; an
          absolute overlay grows the hit area without moving the card's content.
        */
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setConfirmOpen(true)
          }}
          disabled={deleting}
          title={`Delete this ${target.noun}`}
          aria-label={`Delete ${target.noun} "${target.name}"`}
          className={cn(
            'absolute top-2 right-2 z-10 inline-flex size-[2.75rem] items-center justify-center rounded-md bg-card/90 text-muted-foreground transition-colors outline-none hover:text-destructive focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 sm:size-7 sm:opacity-0 sm:group-hover/card:opacity-100 sm:group-focus-within/card:opacity-100',
            className
          )}
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${target.name}"?`}
        description={`${target.description} This cannot be undone.`}
        confirmLabel={`Delete ${target.noun}`}
        destructive
        onConfirm={handleDelete}
      />
    </>
  )
}
