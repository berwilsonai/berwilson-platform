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
import EmptyState from '@/components/shared/EmptyState'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import { toast } from 'sonner'
import { viewDocument, downloadDocument, fetchDocumentText } from '@/lib/utils/document-links'
import type { Document } from '@/lib/supabase/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOC_TYPES = [
  'proposal',
  'contract',
  'drawing',
  'email',
  'report',
  'correspondence',
  'other',
] as const

type DocType = (typeof DOC_TYPES)[number]

const DOC_TYPE_COLORS: Record<DocType, string> = {
  proposal: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60',
  contract: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-purple-200 dark:ring-purple-800/60',
  drawing: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800/60',
  email: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-800/60',
  report: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 ring-teal-200 dark:ring-teal-800/60',
  correspondence: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-orange-200 dark:ring-orange-800/60',
  other: 'bg-slate-100 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 ring-slate-200 dark:ring-slate-800/60',
}

// MIME types that support AI extraction
const AI_ELIGIBLE_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getFileIcon() {
  return <File size={18} className="shrink-0 text-muted-foreground" />
}

// ---------------------------------------------------------------------------
// Upload state
// ---------------------------------------------------------------------------

interface UploadState {
  file: File
  docType: DocType
  extractAi: boolean
  status: 'idle' | 'uploading' | 'processing' | 'done' | 'error'
  error?: string
  progress: number
}

// ---------------------------------------------------------------------------
// DocumentRow
// ---------------------------------------------------------------------------

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: Document
  onDelete: (id: string) => void
}) {
  const [downloading, setDownloading] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleView() {
    setViewing(true)
    try {
      const ok = await viewDocument(`/api/documents/${doc.id}`, doc.mime_type)
      if (!ok) toast.error('Could not open the document. Please try again.')
    } finally {
      setViewing(false)
    }
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      const ok = await downloadDocument(`/api/documents/${doc.id}`)
      if (!ok) toast.error('Could not generate download link. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Delete failed. Please try again.')
        return
      }
      onDelete(doc.id)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const docType = (doc.doc_type ?? 'other') as DocType
  const badgeColor = DOC_TYPE_COLORS[docType] ?? DOC_TYPE_COLORS.other

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
      {/* Row header */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="mt-0.5">{getFileIcon()}</div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <button
            onClick={handleView}
            disabled={viewing}
            className="block max-w-full text-left text-sm font-medium text-foreground truncate hover:underline disabled:opacity-50"
            title="Open document"
          >
            {doc.file_name}
          </button>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {/* doc_type badge */}
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${badgeColor}`}
            >
              {docType}
            </span>
            {/* File size */}
            <span className="text-xs text-muted-foreground">
              {formatBytes(doc.file_size_bytes)}
            </span>
            {/* Upload date */}
            <span className="text-xs text-muted-foreground">
              {formatDate(doc.uploaded_at)}
            </span>
            {/* Confidence badge */}
            {doc.confidence !== null && doc.confidence !== undefined && (
              <ConfidenceBadge confidence={doc.confidence} />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <ReadAloudButton
            getText={async () => {
              const text = await fetchDocumentText(doc.id)
              if (!text) toast.info('No readable text stored for this file — open it and use the Mac’s built-in reader instead.')
              return text
            }}
            iconSize={14}
            className="h-7 w-7 p-0 flex items-center justify-center hover:bg-accent"
          />
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-accent transition-colors disabled:opacity-50"
            title="Download"
          >
            {downloading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} className="text-muted-foreground" />
            )}
          </button>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? '…' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="h-6 w-6 rounded flex items-center justify-center hover:bg-accent transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* AI summary */}
      {doc.ai_summary && (
        <div className="pl-7">
          <p className="text-xs text-muted-foreground leading-relaxed">{doc.ai_summary}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UploadZone
// ---------------------------------------------------------------------------

function UploadZone({
  projectId,
  onUploaded,
}: {
  projectId: string
  onUploaded: (doc: Document) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploads, setUploads] = useState<UploadState[]>([])

  function updateUpload(index: number, patch: Partial<UploadState>) {
    setUploads((prev) =>
      prev.map((u, i) => (i === index ? { ...u, ...patch } : u))
    )
  }

  async function processFile(upload: UploadState, index: number) {
    updateUpload(index, { status: 'uploading', progress: 0 })

    // Send file + metadata to server — admin client handles storage (bypasses RLS)
    const formData = new FormData()
    formData.append('file', upload.file)
    formData.append('project_id', projectId)
    formData.append('doc_type', upload.docType)
    formData.append('extract_ai', String(upload.extractAi && AI_ELIGIBLE_MIMES.has(upload.file.type)))

    updateUpload(index, {
      status: upload.extractAi ? 'processing' : 'uploading',
      progress: 50,
    })

    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const { error } = await res.json()
      updateUpload(index, { status: 'error', error: error ?? 'Failed to save document' })
      return
    }

    const { document: doc } = await res.json()
    updateUpload(index, { status: 'done', progress: 100 })
    onUploaded(doc as Document)
  }

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    const newUploads: UploadState[] = arr.map((f) => ({
      file: f,
      docType: guessDocType(f.name),
      extractAi: AI_ELIGIBLE_MIMES.has(f.type),
      status: 'idle',
      progress: 0,
    }))
    // Don't auto-start — let user review and confirm
    setUploads((prev) => [...prev, ...newUploads])
  }

  function guessDocType(name: string): DocType {
    const lower = name.toLowerCase()
    if (lower.includes('contract') || lower.includes('agreement')) return 'contract'
    if (lower.includes('proposal') || lower.includes('rfp') || lower.includes('rfq')) return 'proposal'
    if (lower.includes('drawing') || lower.includes('plan') || lower.endsWith('.dwg')) return 'drawing'
    if (lower.includes('report')) return 'report'
    if (lower.includes('email') || lower.endsWith('.eml') || lower.endsWith('.msg')) return 'email'
    return 'other'
  }

  function removeUpload(index: number) {
    setUploads((prev) => prev.filter((_, i) => i !== index))
  }

  const pendingUploads = uploads.filter((u) => u.status === 'idle')
  const activeUploads = uploads.filter((u) => u.status !== 'idle')

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors
          ${dragging
            ? 'border-foreground bg-accent'
            : 'border-border hover:border-muted-foreground hover:bg-accent/50'
          }`}
      >
        <Upload size={20} className="text-muted-foreground mb-2" />
        <p className="text-sm font-medium text-foreground">
          Drop files here or <span className="underline">browse</span>
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, DOCX, TXT, images, and more
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Pending (idle) uploads — show per-file config */}
      {pendingUploads.length > 0 && (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Ready to upload ({pendingUploads.length})
            </span>
            <button
              onClick={() => {
                // Start all idle uploads
                const idleOnes = uploads
                  .map((u, i) => ({ u, i }))
                  .filter(({ u }) => u.status === 'idle')

                setUploads((prev) =>
                  prev.map((u) => (u.status === 'idle' ? { ...u, status: 'uploading' as const } : u))
                )

                // Process sequentially
                ;(async () => {
                  for (const { u, i } of idleOnes) {
                    await processFile(u, i)
                  }
                })()
              }}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
            >
              <Upload size={12} />
              Upload all
            </button>
          </div>

          {uploads.map((upload, i) => {
            if (upload.status !== 'idle') return null
            return (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <File size={16} className="shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{upload.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(upload.file.size)}</p>
                </div>

                {/* doc_type selector */}
                <select
                  value={upload.docType}
                  onChange={(e) =>
                    setUploads((prev) =>
                      prev.map((u, idx) =>
                        idx === i ? { ...u, docType: e.target.value as DocType } : u
                      )
                    )
                  }
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>

                {/* AI extraction toggle */}
                {AI_ELIGIBLE_MIMES.has(upload.file.type) && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
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
                    AI summary
                  </label>
                )}

                {/* Remove */}
                <button
                  onClick={() => removeUpload(i)}
                  className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent transition-colors"
                >
                  <X size={12} className="text-muted-foreground" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Active/completed uploads */}
      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload, i) => {
            if (upload.status === 'idle') return null
            return (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
              >
                <File size={16} className="shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{upload.file.name}</p>
                  {upload.status === 'uploading' && (
                    <p className="text-xs text-muted-foreground">Uploading…</p>
                  )}
                  {upload.status === 'processing' && (
                    <p className="text-xs text-muted-foreground">Generating AI summary…</p>
                  )}
                  {upload.status === 'done' && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">Uploaded</p>
                  )}
                  {upload.status === 'error' && (
                    <p className="text-xs text-red-600 dark:text-red-400">{upload.error}</p>
                  )}
                </div>
                {(upload.status === 'uploading' || upload.status === 'processing') && (
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                )}
                {upload.status === 'error' && (
                  <AlertCircle size={14} className="text-red-500 dark:text-red-400" />
                )}
                <button
                  onClick={() => removeUpload(i)}
                  className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent transition-colors"
                >
                  <X size={12} className="text-muted-foreground" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DocumentsTab
// ---------------------------------------------------------------------------

interface DocumentsTabProps {
  projectId: string
  initialDocuments: Document[]
}

export default function DocumentsTab({ projectId, initialDocuments }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [showUpload, setShowUpload] = useState(false)

  function handleUploaded(doc: Document) {
    setDocuments((prev) => [doc, ...prev])
  }

  function handleDeleted(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Documents ({documents.length})
        </h2>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Upload size={12} />
          Upload
        </button>
      </div>

      {/* Upload zone */}
      {showUpload && (
        <UploadZone projectId={projectId} onUploaded={handleUploaded} />
      )}

      {/* Document list */}
      {documents.length === 0 && !showUpload ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Upload contracts, proposals, drawings, and correspondence to keep all project files in one place."
          action={
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              <Upload size={14} />
              Upload First Document
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onDelete={handleDeleted} />
          ))}
        </div>
      )}
    </div>
  )
}
