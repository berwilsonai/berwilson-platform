'use client'

import { useRouter } from 'next/navigation'

import RecordDeleteButton, { type RecordDeleteTarget } from './RecordDeleteButton'

/**
 * The detail page's delete: remove the record, then leave the page that was
 * showing it.
 *
 * ⚠ ITS ONLY JOB IS TO OWN THE ROUTER, which is why it is four lines and its
 * own file. `useRouter` throws outside a Next request, so anything importing it
 * is unverifiable by `renderToStaticMarkup` — keeping it here means
 * `RecordDeleteButton`, where all the behaviour and every class string lives,
 * stays renderable in a test for both of its variants. Same split as
 * `AttentionList`/`AttentionClient`, for the same reason.
 *
 * `refresh()` after `push()` is not redundant: the list being navigated to is a
 * server component and would otherwise render from a cache that still holds the
 * row just deleted.
 */
export default function RecordDeleteAndLeave({
  target,
  backTo,
}: {
  target: RecordDeleteTarget
  /** Where to go once it is gone — the record's own list. */
  backTo: string
}) {
  const router = useRouter()
  return (
    <RecordDeleteButton
      target={target}
      variant="pill"
      onDeleted={() => {
        router.push(backTo)
        router.refresh()
      }}
    />
  )
}
