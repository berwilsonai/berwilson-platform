'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface RaiseDeleteButtonProps {
  raiseId: string
  name: string
}

export default function RaiseDeleteButton({ raiseId, name }: RaiseDeleteButtonProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/raises/${raiseId}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Delete failed' }))
        toast.error(error ?? 'Delete failed')
        setDeleting(false)
        return
      }
      toast.success('Raise deleted')
      router.push('/investors')
      router.refresh()
    } catch {
      toast.error('Delete failed')
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={deleting}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-60"
      >
        {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        Delete
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${name}"?`}
        description="This removes the raise and its tranche schedule. Investments stay — they just come untagged from this raise. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  )
}
