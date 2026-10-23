'use client'

/**
 * The one fetch helper for a client-side mutation: status check, the server's
 * own error sentence in a toast, a success toast, then `router.refresh()`.
 *
 * ⚠ USE THIS RATHER THAN A BARE `fetch`. Two controls hand-rolled it without
 * checking `res.ok` and without a catch, so on a 500 the select showed the new
 * value, the spinner stopped, and `router.refresh()` then snapped it back to
 * the old one with nothing said — a save that silently did not happen
 * (OpportunityStatusControl / InvestorStageControl, repaired 2026-10-17).
 *
 * ⚠ LIVES IN src/hooks, NOT src/lib. It is a hook, so only a client component
 * can call it — and src/lib is where a SERVER page looks, where importing a
 * `'use client'` export throws at REQUEST time with neither `tsc` nor the build
 * catching it (CLAUDE.md §12, 07-11). It lived under the Vehicles module's own
 * components until 10-17, moved here so a server page could reach it, and
 * outlived that module when it was removed on 10-23 — which is the whole
 * argument for src/lib in one sentence.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export type Draft = Record<string, string | boolean>

/**
 * An empty string means "nobody has said". It must never arrive as 0.
 *
 * A win probability cleared to 0% says we judge the deal lost, which is a
 * different fact from nobody having judged it — and the readers treat the two
 * differently on purpose.
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
      // The figures on each card are server-rendered, so a save refreshes the
      // route rather than this component keeping its own idea of the answer.
      // One source, one number on the screen.
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
