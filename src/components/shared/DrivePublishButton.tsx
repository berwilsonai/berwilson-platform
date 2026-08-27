'use client'

import { useState } from 'react'
import { FolderUp, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface DrivePublishButtonProps {
  kind: 'project' | 'opportunity' | 'steel'
  id: string
  /** Folder link already stored on the record, if it has been published before. */
  folderUrl?: string | null
}

/**
 * Copy this record's documents into a Google Drive folder shared with the
 * company.
 *
 * Exists because Ber Intelligence is tailnet-only: the documents attached here
 * are unreachable for most of the team on most devices. This does not move them
 * — the platform stays the system of record — it publishes a readable copy to
 * where everyone already works.
 */
export default function DrivePublishButton({ kind, id, folderUrl }: DrivePublishButtonProps) {
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(folderUrl ?? null)

  async function publish() {
    setBusy(true)
    try {
      const res = await fetch('/api/drive/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Publish failed')

      setUrl(data.folderUrl)
      const parts = [
        data.uploaded > 0 ? `${data.uploaded} file${data.uploaded === 1 ? '' : 's'} published` : null,
        data.alreadyPublished > 0 ? `${data.alreadyPublished} already there` : null,
        data.failed > 0 ? `${data.failed} failed` : null,
      ].filter(Boolean)
      toast.success(parts.length ? parts.join(' · ') : 'Nothing new to publish')
      if (data.errors?.length) toast.error(String(data.errors[0]))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ExternalLink className="size-3.5" />
          Drive folder
        </a>
      )}
      <Button variant="outline" size="sm" className="h-8" onClick={publish} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderUp className="size-3.5" />}
        {url ? 'Update Drive' : 'Publish to Drive'}
      </Button>
    </div>
  )
}
