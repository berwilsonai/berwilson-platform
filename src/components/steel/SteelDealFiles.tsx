'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Download, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import DrivePublishButton from '@/components/shared/DrivePublishButton'
import { createClient } from '@/lib/supabase/client'
import { viewDocument, downloadDocument } from '@/lib/utils/document-links'
import type { Document } from '@/lib/supabase/types'

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  dealId: string
  files: Document[]
  canEdit: boolean
  /** Drive folder this deal has already been published to, if any. */
  driveFolderUrl?: string | null
  /** Publishing is a sharing decision, so the control is admin-only. */
  canPublish?: boolean
}

export default function SteelDealFiles({
  dealId,
  files: initial,
  canEdit,
  driveFolderUrl,
  canPublish,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Document[]>(initial)
  const [uploading, setUploading] = useState(false)

  async function upload(file: File) {
    setUploading(true)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `steel-deals/${dealId}/${Date.now()}_${safeName}`

      const signRes = await fetch('/api/steel/documents/signed-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: path }),
      })
      const signData = await signRes.json()
      if (!signRes.ok) {
        toast.error(signData.error ?? 'Could not start the upload.')
        return
      }

      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from('documents')
        .uploadToSignedUrl(signData.path, signData.token, file)
      if (upErr) {
        toast.error(`Upload failed: ${upErr.message}`)
        return
      }

      const regRes = await fetch('/api/steel/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steel_deal_id: dealId,
          storage_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type || null,
          doc_type: 'other',
        }),
      })
      const regData = await regRes.json()
      if (!regRes.ok) {
        toast.error(regData.error ?? 'Could not register the file.')
        return
      }
      setFiles((prev) => [regData.document as Document, ...prev])
      toast.success('File attached.')
    } finally {
      setUploading(false)
    }
  }

  async function remove(doc: Document) {
    const res = await fetch(`/api/steel/documents/${doc.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Could not delete the file.')
      return
    }
    setFiles((prev) => prev.filter((f) => f.id !== doc.id))
  }

  return (
    <div className="space-y-2">
      {(canEdit || canPublish) && (
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Add file
              </button>
              <span className="text-[11px] text-muted-foreground">Architect plans, engineering quotes, signed orders…</span>
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload(f)
                  e.target.value = ''
                }}
              />
            </>
          )}

          {/* Gated on canPublish alone, not on canEdit — the two permissions are
              genuinely different (a steel rep may attach files but may not share
              them out of the tailnet), so neither should imply the other. */}
          {canPublish && (
            <div className="ml-auto">
              <DrivePublishButton kind="steel" id={dealId} folderUrl={driveFolderUrl} />
            </div>
          )}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files attached yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
              <FileText size={15} className="text-muted-foreground shrink-0" />
              <button
                onClick={() => viewDocument(`/api/steel/documents/${doc.id}`, doc.mime_type)}
                className="flex-1 min-w-0 text-left text-sm truncate hover:underline"
                title={doc.file_name}
              >
                {doc.file_name}
              </button>
              <span className="text-xs text-muted-foreground shrink-0">{formatBytes(doc.file_size_bytes)}</span>
              <button
                onClick={() => downloadDocument(`/api/steel/documents/${doc.id}`)}
                className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                title="Download"
              >
                <Download size={13} />
              </button>
              {canEdit && (
                <button
                  onClick={() => remove(doc)}
                  className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
