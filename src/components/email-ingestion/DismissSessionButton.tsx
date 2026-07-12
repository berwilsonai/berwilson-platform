'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/** Clears a failed, stale, or unwanted pending research run out of the Recent list. */
export default function DismissSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function dismiss(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setBusy(true)
    try {
      const res = await fetch(`/api/email-ingestion/sessions/${sessionId}`, { method: 'PATCH' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not dismiss the session.')
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not dismiss the session.')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      disabled={busy}
      title="Dismiss"
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 disabled:opacity-50"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
    </button>
  )
}
