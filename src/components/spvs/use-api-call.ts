'use client'

/**
 * The one fetch helper the vehicle surfaces share, and the draft coercion.
 *
 * ⚠ ITS OWN MODULE TO BREAK A CYCLE. The board renders the cards and the cards
 * need the helper, so leaving it on the board made the two import each other.
 * A bundler tolerates that; a reader does not, and the next helper added to
 * either file would inherit the tangle.
 *
 * `OrgNodeOption` deliberately lives in src/lib/spvs/types.ts instead, because
 * a SERVER component reads the org chart for the picker — and every export of a
 * `'use client'` module becomes a client reference, which throws at REQUEST
 * time with neither `tsc` nor the build catching it (CLAUDE.md §12, 07-11).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export type Draft = Record<string, string | boolean>

/**
 * An empty string means "nobody has said". It must never arrive as 0.
 *
 * An equity split cleared to 0% says a partner holds none of the vehicle, which
 * is a different fact from nobody having agreed one — and the engine treats the
 * two differently on purpose.
 */
export function outbound(draft: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (typeof value === 'boolean') body[key] = value
    else body[key] = value.trim() === '' ? null : value
  }
  return body
}

export function useApiCall() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function call(
    key: string,
    path: string,
    method: string,
    body?: unknown,
    successMessage?: string
  ): Promise<boolean> {
    setBusy(key)
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        // The routes answer with a sentence that names the fix, so show that
        // rather than a generic failure.
        toast.error(payload.error ?? 'That did not save')
        return false
      }
      if (successMessage) toast.success(successMessage)
      // The money on each card is server-rendered from the economics engine, so
      // a save refreshes the route rather than this component keeping its own
      // idea of the answer. One engine, one number on the screen.
      router.refresh()
      return true
    } catch {
      toast.error('That did not save')
      return false
    } finally {
      setBusy(null)
    }
  }

  return { busy, call }
}
