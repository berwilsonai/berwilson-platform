'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'

interface OpportunityDeleteButtonProps {
  opportunityId: string
  name: string
}

export default function OpportunityDeleteButton({ opportunityId, name }: OpportunityDeleteButtonProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete "${name}"? This removes the opportunity and its attached documents. This cannot be undone.`)) {
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Delete failed' }))
        alert(error ?? 'Delete failed')
        setDeleting(false)
        return
      }
      router.push('/opportunities')
      router.refresh()
    } catch {
      alert('Delete failed')
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-60"
    >
      {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      Delete
    </button>
  )
}
