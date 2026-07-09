'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Download, Trash2, File, Loader2, Sparkles } from 'lucide-react'
import { viewDocument, downloadDocument } from '@/lib/utils/document-links'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { OpportunityDocument } from '@/lib/supabase/types'
import { OPPORTUNITY_DOC_TYPES, OPPORTUNITY_DOC_TYPE_LABELS } from '@/lib/utils/opportunities'

const AI_ELIGIBLE_MIMES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/pdf'])

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface OpportunityDocumentsProps {
  opportunityId: string
  documents: OpportunityDocument[]
}

export default function OpportunityDocuments({ opportunityId, documents }: OpportunityDocumentsProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<string>('white_paper')
  const [extractAi, setExtractAi] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<OpportunityDocument | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('opportunity_id', opportunityId)
        fd.append('doc_type', docType)
        fd.append('extract_ai', String(extractAi && AI_ELIGIBLE_MIMES.has(file.type)))
        const res = await fetch('/api/opportunities/documents', { method: 'POST', body: fd })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(error ?? 'Upload failed')
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleView(doc: OpportunityDocument) {
    setBusyId(doc.id)
    try {
      const ok = await viewDocument(`/api/opportunities/documents/${doc.id}`, doc.mime_type)
      if (!ok) toast.error('Could not open the document.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDownload(doc: OpportunityDocument) {
    setBusyId(doc.id)
    try {
      const ok = await downloadDocument(`/api/opportunities/documents/${doc.id}`)
      if (!ok) toast.error('Could not generate download link.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(doc: OpportunityDocument) {
    setBusyId(doc.id)
    try {
      const res = await fetch(`/api/opportunities/documents/${doc.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Delete failed' }))
        toast.error(error ?? 'Delete failed')
        return
      }
      toast.success('Document deleted')
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      {/* Upload area */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {OPPORTUNITY_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {OPPORTUNITY_DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={extractAi}
              onChange={(e) => setExtractAi(e.target.checked)}
              className="rounded border-input"
            />
            <Sparkles size={12} />
            AI summary
          </label>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (!uploading) handleFiles(e.dataTransfer.files)
          }}
          onClick={() => { if (!uploading) fileInputRef.current?.click() }}
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-6 transition-colors
            ${uploading ? 'cursor-default opacity-70' : 'cursor-pointer'}
            ${dragging
              ? 'border-foreground bg-accent'
              : 'border-border hover:border-muted-foreground hover:bg-accent/50'
            }`}
        >
          {uploading ? (
            <Loader2 size={18} className="text-muted-foreground mb-1.5 animate-spin" />
          ) : (
            <Upload size={18} className="text-muted-foreground mb-1.5" />
          )}
          <p className="text-sm font-medium text-foreground">
            {uploading ? 'Uploading…' : <>Drop files here or <span className="underline">browse</span></>}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            White papers, teasers, CIMs, financials
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Document list */}
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No documents yet. Upload white papers, teasers, CIMs, or financials.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="p-3">
              <div className="flex items-start gap-3">
                <File size={18} className="shrink-0 mt-0.5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleView(doc)}
                      disabled={busyId === doc.id}
                      className="text-left text-sm font-medium truncate hover:underline disabled:opacity-50"
                      title="Open document"
                    >
                      {doc.file_name}
                    </button>
                    {doc.doc_type && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {OPPORTUNITY_DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatBytes(doc.file_size_bytes)}
                  </p>
                  {doc.ai_summary && (
                    <p className="mt-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 flex gap-1.5">
                      <Sparkles size={12} className="shrink-0 mt-0.5 text-primary" />
                      <span>{doc.ai_summary}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDownload(doc)}
                    disabled={busyId === doc.id}
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Download"
                  >
                    {busyId === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  </button>
                  <button
                    onClick={() => setPendingDelete(doc)}
                    disabled={busyId === doc.id}
                    className={cn(
                      'p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
                    )}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={pendingDelete ? `Delete "${pendingDelete.file_name}"?` : 'Delete document?'}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { if (pendingDelete) await handleDelete(pendingDelete) }}
      />
    </div>
  )
}
