'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Upload,
  FileText,
  Loader2,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'

export interface CompanyDoc {
  id: string
  file_name: string
  doc_type: string | null
  ai_summary: string | null
  embedding_status: string | null
  uploaded_at: string | null
}

interface CompanyKnowledgeBaseProps {
  documents: CompanyDoc[]
}

// Company-relevant document types — drives how the corpus is organized.
const DOC_TYPES = [
  'capability_statement',
  'past_performance',
  'resume',
  'certification',
  'safety',
  'financial',
  'other',
] as const

function label(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function guessType(name: string): string {
  const l = name.toLowerCase()
  if (l.includes('capability') || l.includes('cap state')) return 'capability_statement'
  if (l.includes('past perf') || l.includes('reference') || l.includes('project list')) return 'past_performance'
  if (l.includes('resume') || l.includes('cv') || l.includes('bio')) return 'resume'
  if (l.includes('cert') || l.includes('license') || l.includes('dbe') || l.includes('mbe')) return 'certification'
  if (l.includes('safety') || l.includes('emr') || l.includes('osha')) return 'safety'
  if (l.includes('financial') || l.includes('bond') || l.includes('audit')) return 'financial'
  return 'other'
}

export default function CompanyKnowledgeBase({ documents }: CompanyKnowledgeBaseProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [docType, setDocType] = useState<string>('capability_statement')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    let ok = 0
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('is_company', 'true')
      formData.append('doc_type', docType === 'other' ? guessType(file.name) : docType)
      formData.append('extract_ai', 'true')
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      if (res.ok) ok++
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (ok > 0) {
      toast.success(`Added ${ok} document${ok > 1 ? 's' : ''} — indexing for AI in the background`)
      router.refresh()
    } else {
      toast.error('Upload failed')
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) {
      toast.success('Removed from knowledge base')
      router.refresh()
    } else {
      toast.error('Delete failed')
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Knowledge Base
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Upload Ber Wilson&apos;s own documents — capability statements, past performance, resumes,
          credentials, safety record. Ber AI reads these when answering portfolio questions and when
          assessing whether to pursue an RFP.
        </p>
      </div>

      {/* Upload area */}
      <div className="rounded-xl border border-border bg-card p-3 elev-1 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground">Document type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{label(t)}</option>
            ))}
          </select>
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
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors
            ${uploading ? 'cursor-default opacity-70' : 'cursor-pointer'}
            ${dragging
              ? 'border-foreground bg-accent'
              : 'border-border hover:border-muted-foreground hover:bg-accent/50'
            }`}
        >
          {uploading ? (
            <Loader2 size={20} className="text-muted-foreground mb-2 animate-spin" />
          ) : (
            <Upload size={20} className="text-muted-foreground mb-2" />
          )}
          <p className="text-sm font-medium text-foreground">
            {uploading ? 'Uploading…' : <>Drop files here or <span className="underline">browse</span></>}
          </p>
          <p className="text-xs text-muted-foreground mt-1">PDF, Word, text, CSV</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            accept=".pdf,.docx,.doc,.txt,.csv,.md"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Document list */}
      {documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <FileText size={22} className="mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground mt-2">No company documents yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 elev-1"
            >
              <FileText size={18} className="shrink-0 mt-0.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">{doc.file_name}</p>
                  {doc.doc_type && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
                      {label(doc.doc_type)}
                    </span>
                  )}
                  <EmbedStatus status={doc.embedding_status} />
                </div>
                {doc.ai_summary && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.ai_summary}</p>
                )}
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                disabled={deletingId === doc.id}
                className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-red-500 transition-colors disabled:opacity-50"
                aria-label="Delete document"
              >
                {deletingId === doc.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function EmbedStatus({ status }: { status: string | null }) {
  if (status === 'complete')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={11} /> Indexed
      </span>
    )
  if (status === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-500">
        <AlertCircle size={11} /> Index failed
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
      <Clock size={11} /> Indexing…
    </span>
  )
}
