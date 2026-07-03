'use client'

import { useState, useRef } from 'react'
import {
  FileText,
  Upload,
  Download,
  Trash2,
  X,
  AlertCircle,
  Loader2,
  File,
} from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createClient } from '@/lib/supabase/client'
import type { Document } from '@/lib/supabase/types'

const DOC_TYPES = [
  'proposal',
  'contract',
  'report',
  'correspondence',
  'other',
] as const

type DocType = (typeof DOC_TYPES)[number]

const DOC_TYPE_COLORS: Record<DocType, string> = {
  proposal: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60',
  contract: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-purple-200 dark:ring-purple-800/60',
  report: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 ring-teal-200 dark:ring-teal-800/60',
  correspondence: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-orange-200 dark:ring-orange-800/60',
  other: 'bg-slate-100 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 ring-slate-200 dark:ring-slate-800/60',
}

const AI_ELIGIBLE_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
])

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface UploadState {
  file: File
  docType: DocType
  extractAi: boolean
  status: 'idle' | 'uploading' | 'processing' | 'done' | 'error'
  error?: string
}

interface VendorDocumentsProps {
  entityId: string
  initialDocuments: Document[]
}

export default function VendorDocuments({ entityId, initialDocuments }: VendorDocumentsProps) {
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [showUpload, setShowUpload] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadState[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    const newUploads: UploadState[] = arr.map((f) => ({
      file: f,
      docType: 'other' as DocType,
      extractAi: AI_ELIGIBLE_MIMES.has(f.type),
      status: 'idle',
    }))
    setUploads((prev) => [...prev, ...newUploads])
    if (!showUpload) setShowUpload(true)
  }

  async function processFile(upload: UploadState, index: number) {
    setUploads((prev) =>
      prev.map((u, i) => (i === index ? { ...u, status: 'uploading' } : u))
    )

    const formData = new FormData()
    formData.append('file', upload.file)
    formData.append('entity_id', entityId)
    formData.append('doc_type', upload.docType)
    formData.append('extract_ai', String(upload.extractAi && AI_ELIGIBLE_MIMES.has(upload.file.type)))

    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const { error } = await res.json()
      setUploads((prev) =>
        prev.map((u, i) => (i === index ? { ...u, status: 'error', error: error ?? 'Upload failed' } : u))
      )
      return
    }

    const { document: doc } = await res.json()
    setUploads((prev) =>
      prev.map((u, i) => (i === index ? { ...u, status: 'done' } : u))
    )
    setDocuments((prev) => [doc as Document, ...prev])
  }

  async function handleUploadAll() {
    const idleOnes = uploads
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => u.status === 'idle')

    for (const { u, i } of idleOnes) {
      await processFile(u, i)
    }
  }

  function removeUpload(index: number) {
    setUploads((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleDownload(doc: Document) {
    const supabase = createClient()
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.storage_path, 120)

    if (error || !data?.signedUrl) {
      toast.error('Could not generate download link.')
      return
    }

    const a = document.createElement('a')
    a.href = data.signedUrl
    a.download = doc.file_name
    a.target = '_blank'
    a.click()
  }

  async function handleDelete(docId: string) {
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
    if (res.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
      toast.success('Document deleted')
    } else {
      toast.error('Delete failed')
    }
  }

  const pendingUploads = uploads.filter((u) => u.status === 'idle')

  return (
    <section className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">
          Documents ({documents.length})
        </h3>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
        >
          <Upload size={11} />
          Upload
        </button>
      </div>

      {showUpload && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              handleFiles(e.dataTransfer.files)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors
              ${dragging
                ? 'border-foreground bg-accent'
                : 'border-border hover:border-muted-foreground hover:bg-accent/50'
              }`}
          >
            <Upload size={16} className="text-muted-foreground mb-1.5" />
            <p className="text-xs font-medium">
              Drop files or <span className="underline">browse</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Certifications, insurance, W-9, capability statements
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          {pendingUploads.length > 0 && (
            <div className="space-y-2">
              {uploads.map((upload, i) => {
                if (upload.status !== 'idle') return null
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <File size={12} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{upload.file.name}</span>
                    <select
                      value={upload.docType}
                      onChange={(e) =>
                        setUploads((prev) =>
                          prev.map((u, idx) =>
                            idx === i ? { ...u, docType: e.target.value as DocType } : u
                          )
                        )
                      }
                      className="h-6 rounded border border-input bg-background px-1.5 text-xs"
                    >
                      {DOC_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    {AI_ELIGIBLE_MIMES.has(upload.file.type) && (
                      <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <input
                          type="checkbox"
                          checked={upload.extractAi}
                          onChange={(e) =>
                            setUploads((prev) =>
                              prev.map((u, idx) =>
                                idx === i ? { ...u, extractAi: e.target.checked } : u
                              )
                            )
                          }
                          className="rounded"
                        />
                        AI
                      </label>
                    )}
                    <button onClick={() => removeUpload(i)}>
                      <X size={10} className="text-muted-foreground" />
                    </button>
                  </div>
                )
              })}
              <button
                onClick={handleUploadAll}
                className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
              >
                <Upload size={11} />
                Upload all
              </button>
            </div>
          )}

          {/* Active/completed uploads */}
          {uploads.filter((u) => u.status !== 'idle').map((upload, i) => (
            <div key={`active-${i}`} className="flex items-center gap-2 text-xs">
              <File size={12} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{upload.file.name}</span>
              {(upload.status === 'uploading' || upload.status === 'processing') && (
                <Loader2 size={12} className="animate-spin text-muted-foreground" />
              )}
              {upload.status === 'done' && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">Done</span>
              )}
              {upload.status === 'error' && (
                <span className="text-xs text-red-600 dark:text-red-400">{upload.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Document list */}
      {documents.length === 0 && !showUpload ? (
        <p className="text-xs text-muted-foreground py-2">
          No documents uploaded. Add certifications, insurance, capability statements, and more.
        </p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const docType = (doc.doc_type ?? 'other') as DocType
            return (
              <div key={doc.id} className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
                <File size={14} className="shrink-0 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-flex rounded px-1 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${DOC_TYPE_COLORS[docType] ?? DOC_TYPE_COLORS.other}`}>
                      {docType}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatBytes(doc.file_size_bytes)}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(doc.uploaded_at)}</span>
                  </div>
                  {doc.ai_summary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.ai_summary}</p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleDownload(doc)}
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent transition-colors"
                  >
                    <Download size={11} className="text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(doc.id)}
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  >
                    <Trash2 size={11} className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
        title="Delete this document?"
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { if (pendingDeleteId) await handleDelete(pendingDeleteId) }}
      />
    </section>
  )
}
