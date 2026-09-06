'use client'

import { useState } from 'react'
import { FolderDown, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Pull this project's deal folder in from Drive.
 *
 * The inbound counterpart to DrivePublishButton, and only shown on a project
 * that came from the website deal form — those are the ones with a folder the
 * team keeps adding to during diligence. The nightly cron does this anyway;
 * this is for the moment someone has just dropped the appraisal in and wants to
 * ask Ber AI about it now.
 *
 * Idempotent: unchanged files cost a list entry and nothing else.
 */
export default function DriveImportButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Import failed')

      const parts = [
        data.added > 0 ? `${data.added} imported` : null,
        data.updated > 0 ? `${data.updated} updated` : null,
        data.failed > 0 ? `${data.failed} failed` : null,
      ].filter(Boolean)
      toast.success(parts.length ? parts.join(' · ') : 'Nothing new in the folder')
      if (data.errors?.length) toast.error(String(data.errors[0]))
      // Indexing happened server-side; the list needs re-reading to show it.
      if (data.added > 0 || data.updated > 0) router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy ? (
        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
      ) : (
        <FolderDown className="mr-1.5 size-3.5" />
      )}
      {busy ? 'Importing…' : 'Sync from Drive'}
    </Button>
  )
}
