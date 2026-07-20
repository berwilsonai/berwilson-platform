'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Download, Trash2, Loader2 } from 'lucide-react'
import { viewDocument, downloadDocument } from '@/lib/utils/document-links'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/** Open / download / delete actions for a reference document in the reader header. */
export default function ReferenceDocActions({
  documentId,
  mimeType,
}: {
  documentId: string
  mimeType: string | null
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function onDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/documents/${documentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      router.push('/intake?tab=document')
    } catch {
      setDeleting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => viewDocument(`/api/documents/${documentId}`, mimeType)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
      >
        <ExternalLink size={13} />
        Open
      </button>
      <button
        type="button"
        onClick={() => downloadDocument(`/api/documents/${documentId}`)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
      >
        <Download size={13} />
        Download
      </button>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center justify-center size-8 rounded-md border border-input bg-background text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
        aria-label="Delete document"
      >
        {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this document?"
        description="The document, its summary, and its indexed text are removed permanently. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
    </div>
  )
}
