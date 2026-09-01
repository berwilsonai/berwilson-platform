'use client'

import { useRef, useState } from 'react'
import { Upload, Mic, FileText, Download, Trash2, Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { viewDocument, downloadDocument } from '@/lib/utils/document-links'
import { RECORDING_ACCEPT } from '@/lib/utils/meetings'
import type { Document } from '@/lib/supabase/types'

function isAudio(mime: string | null): boolean {
  return !!mime && mime.startsWith('audio/')
}

function isVideo(mime: string | null): boolean {
  return !!mime && mime.startsWith('video/')
}

/** Audio or video — both are transcribable (afconvert extracts the audio track). */
function isMedia(mime: string | null): boolean {
  return isAudio(mime) || isVideo(mime)
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  meetingId: string
  files: Document[]
  canEdit: boolean
  onChange: (files: Document[]) => void
  /** Fired after a recording (audio or video) is attached (used to auto-transcribe). */
  onAudioUploaded?: (doc: Document) => void
}

export default function MeetingFiles({ meetingId, files, canEdit, onChange, onAudioUploaded }: Props) {
  const audioInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null)

  async function upload(file: File) {
    setUploading(true)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `meetings/${meetingId}/${Date.now()}_${safeName}`

      const signRes = await fetch('/api/documents/signed-upload-url', {
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

      const regRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meeting_id: meetingId,
          storage_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type || null,
          doc_type: 'other',
          extract_ai: false,
        }),
      })
      const regData = await regRes.json()
      if (!regRes.ok) {
        toast.error(regData.error ?? 'Could not register the file.')
        return
      }
      const newDoc = regData.document as Document
      onChange([newDoc, ...files])
      toast.success('File attached.')
      if (isMedia(newDoc.mime_type)) onAudioUploaded?.(newDoc)
    } finally {
      setUploading(false)
    }
  }

  async function loadAudio(doc: Document) {
    setLoadingAudio(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}`)
      const data = await res.json()
      if (!res.ok || !data.url) {
        toast.error('Could not load the recording.')
        return
      }
      setAudioUrls((prev) => ({ ...prev, [doc.id]: data.url }))
    } finally {
      setLoadingAudio(null)
    }
  }

  async function remove(doc: Document) {
    const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Could not delete the file.')
      return
    }
    onChange(files.filter((f) => f.id !== doc.id))
  }

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => audioInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
            Add recording
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Upload size={13} /> Add file
          </button>
          <input
            ref={audioInputRef}
            type="file"
            accept={RECORDING_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ''
            }}
          />
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
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files attached yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((doc) => (
            <div key={doc.id} className="rounded-md bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                {isMedia(doc.mime_type) ? <Mic size={15} className="text-muted-foreground shrink-0" /> : <FileText size={15} className="text-muted-foreground shrink-0" />}
                <button
                  onClick={() => viewDocument(`/api/documents/${doc.id}`, doc.mime_type)}
                  className="flex-1 min-w-0 text-left text-sm truncate hover:underline"
                  title={doc.file_name}
                >
                  {doc.file_name}
                </button>
                <span className="text-xs text-muted-foreground shrink-0">{formatBytes(doc.file_size_bytes)}</span>
                {isMedia(doc.mime_type) && !audioUrls[doc.id] && (
                  <button
                    onClick={() => loadAudio(doc)}
                    disabled={loadingAudio === doc.id}
                    className="shrink-0 h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                    title="Play"
                  >
                    {loadingAudio === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  </button>
                )}
                <button
                  onClick={() => downloadDocument(`/api/documents/${doc.id}`)}
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
              {audioUrls[doc.id] && (
                isVideo(doc.mime_type) ? (
                  <video controls autoPlay src={audioUrls[doc.id]} className="mt-2 w-full max-h-80 rounded" />
                ) : (
                  <audio controls autoPlay src={audioUrls[doc.id]} className="mt-2 w-full h-8" />
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
