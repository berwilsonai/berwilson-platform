'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * Stop a half-typed form being thrown away by one stray click.
 *
 * ⚠ There was no guard of any kind in the repo — no `beforeunload`, nothing —
 * and the three longest forms in it are a project, an opportunity and a steel
 * deal, each a page of typing against a server action that only exists once
 * Save is pressed. A sidebar click, a breadcrumb or a reload lost the lot
 * with no prompt.
 *
 * Two different exits need two different mechanisms, which is why this is one
 * component rather than a one-line hook:
 *
 *  - LEAVING THE BROWSER (reload, close, an external link) is `beforeunload`,
 *    whose prompt is the browser's own and cannot be styled or worded.
 *  - LEAVING INSIDE THE APP is a `Link` click, which `beforeunload` never sees
 *    because the page never unloads. App Router exposes no navigation event to
 *    block, so the click is caught in the CAPTURE phase on `document` —
 *    upstream of React's own root listener, so Next's Link handler never runs
 *    — and the href is held until the reader answers.
 *
 * Deliberately NOT a draft saved to localStorage. A restored draft has to put
 * values back into controls, and half the fields here are custom components
 * holding React state (DatePicker, TagInput) that a DOM write would not
 * reach: the restore would silently drop exactly the fields a reader is least
 * likely to re-check. Preventing the loss needs no such guesswork.
 */
export default function UnsavedGuard({ active }: { active: boolean }) {
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return

    function onBeforeUnload(e: BeforeUnloadEvent) {
      // preventDefault is what asks the browser to prompt; the old
      // `returnValue` string has not been shown by any browser for years.
      e.preventDefault()
    }

    function onClick(e: MouseEvent) {
      // Anything already handled, a modified click (new tab/window) or a
      // non-primary button is the reader's deliberate choice — leave it alone.
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const target = e.target as HTMLElement | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const url = new URL(anchor.href, window.location.href)
      // A different origin unloads the page, so `beforeunload` has it. The
      // same path is not a navigation worth interrupting (a tab query on the
      // page the form is already on).
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return

      e.preventDefault()
      e.stopPropagation()
      setPendingHref(url.pathname + url.search)
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active])

  return (
    <ConfirmDialog
      open={pendingHref !== null}
      onOpenChange={(open) => {
        if (!open) setPendingHref(null)
      }}
      title="Leave without saving?"
      description="This form has changes that have not been saved. Leaving now discards them."
      confirmLabel="Discard and leave"
      cancelLabel="Keep editing"
      destructive
      onConfirm={() => {
        const href = pendingHref
        setPendingHref(null)
        if (href) router.push(href)
      }}
    />
  )
}
