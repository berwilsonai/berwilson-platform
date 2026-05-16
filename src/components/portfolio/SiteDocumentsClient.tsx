'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, File, Download, Trash2, X, Loader2, AlertCircle, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Document } from '@/lib/supabase/types'
import { formatDate } from '@/lib/utils/constants'

const DOC_TYPES = [
  'contract', 'proposal', 'permit', 'report', 'drawing',
  'correspondence', 'legal', 'financial', 'other',
] as const
type DocType = (typeof DOC_TYPES)[number]

const DOC_TYPE_BADGE: Record<DocType, string> = {
  contract: 'bg-blue-50 text-blue-700 ring-blue-200',
  proposal: 'bg-violet-50 text-violet-700 ring-violet-200',
  permit: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  report: 'bg-amber-50 text-amber-700 ring-amber-200',
  drawing: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  correspondence: 'bg-slate-100 text-slate-600 ring-slate-200',
  legal: 'bg-red-50 text-red-600 ring-red-200',
  financial: 'bg-orange-50 text-orange-700 ring-orange-200',
  other: 'bg-slate-50 text-slate-500 ring-slate-200',
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function guessDocType(name: string): DocType {
  const lower = name.toLowerCase()
  if (lower.includes('contract') || lower.includes('agreement')) return 'contract'
  if (lower.includes('proposal') || lower.includes('rfp') || lower.includes('rfq')) return 'proposal'
  if (lower.includes('permit') || lower.includes('license')) return 'permit'
  if (lower.includes('drawing') || lower.includes('plan') || lower.endsWith('.dwg')) return 'drawing'
  if (lower.includes('report')) return 'report'
  if (lower.includes('legal') || lower.includes('easement') || lower.includes('deed')) return 'legal'
  if (lower.includes('financial') || lower.includes('budget') || lower.includes('invoice')) return 'financial'
  return 'other'
}

interface UploadItem {
  file: File
  docType: DocType
  status: 'idle' | 'uploading' | 'done' | 'error'
  error?: string
}

interface SiteDocumentsClientProps {
  siteId: string
  initialDocuments: Document[]
}

export default function SiteDocumentsClient({ siteId, initialDocuments }: SiteDocumentsClientProps) {
  const router = useRouter()
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [showUpload, setShowUpload] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    const newItems: UploadItem[] = arr.map(f => ({
      file: f,
      docType: guessDocType(f.name),
      status: 'idle',
    }))
    setUploads(prev => [...prev, ...newItems])
  }

  function updateUpload(index: number, patch: Partial<UploadItem>) {
    setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...patch } : u))
  }

  async function processFile(upload: UploadItem, index: number) {
    updateUpload(index, { status: 'uploading' })
    const formData = new FormData()
    formData.append('file', upload.file)
    formData.append('site_id', siteId)
    formData.append('doc_type', upload.docType)
    formData.append('extract_ai', 'false')

    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const { error } = await res.json()
        updateUpload(index, { status: 'error', error: error ?? 'Upload failed' })
        return
      }
      const { document: doc } = await res.json()
      updateUpload(index, { status: 'done' })
      setDocuments(prev => [doc, ...prev])
    } catch {
      updateUpload(index, { status: 'error', error: 'Upload failed' })
    }
  }

  async function handleUploadAll() {
    const idleItems = uploads
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => u.status === 'idle')
    for (const { u, i } of idleItems) {
      await processFile(u, i)
    }
    router.refresh()
  }

  async function handleDownload(doc: Document) {
    setDownloading(doc.id)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 120)
      if (error || !data?.signedUrl) { alert('Could not generate download link.'); return }
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = doc.file_name
      a.target = '_blank'
      a.click()
    } finally {
      setDownloading(null)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      if (!res.ok) { alert((await res.json()).error ?? 'Delete failed'); return }
      setDocuments(prev => prev.filter(d => d.id !== id))
      router.refresh()
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const pendingCount = uploads.filter(u => u.status === 'idle').length

  return (
    <div className="mt-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{documents.length} document{documents.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors"
        >
          <Upload size={13} />
          Upload
        </button>
      </div>

      {/* Upload zone */}
      {showUpload && (
        <div className="space-y-3">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${dragging ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'}`}
          >
            <Upload size={20} className="text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700">Drop files here or <span className="underline">browse</span></p>
            <p className="text-xs text-slate-400 mt-1">PDF, DOCX, images, and more</p>
            <input ref={fileInputRef} type="file" multiple className="sr-only" onChange={e => e.target.files && handleFiles(e.target.files)} />
          </div>

          {uploads.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
              {pendingCount > 0 && (
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-medium">{pendingCount} file{pendingCount !== 1 ? 's' : ''} ready</span>
                  <button
                    onClick={handleUploadAll}
                    className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors"
                  >
                    <Upload size={11} />
                    Upload all
                  </button>
                </div>
              )}
              {uploads.map((upload, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <File size={15} className="shrink-0 text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{upload.file.name}</p>
                    {upload.status === 'uploading' && <p className="text-xs text-slate-400">Uploading…</p>}
                    {upload.status === 'done' && <p className="text-xs text-emerald-600">Uploaded</p>}
                    {upload.status === 'error' && <p className="text-xs text-red-600">{upload.error}</p>}
                  </div>
                  {upload.status === 'idle' && (
                    <select
                      value={upload.docType}
                      onChange={e => setUploads(prev => prev.map((u, idx) => idx === i ? { ...u, docType: e.target.value as DocType } : u))}
                      className="h-7 rounded-md border border-slate-200 bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {DOC_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  )}
                  {upload.status === 'uploading' && <Loader2 size={14} className="animate-spin text-slate-400 shrink-0" />}
                  {upload.status === 'error' && <AlertCircle size={14} className="text-red-500 shrink-0" />}
                  <button
                    onClick={() => setUploads(prev => prev.filter((_, idx) => idx !== i))}
                    className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <X size={11} className="text-slate-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Document list */}
      {documents.length === 0 && !showUpload ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <FileText size={24} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400 mb-3">No documents linked to this site yet.</p>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            <Upload size={13} />
            Upload Document
          </button>
        </div>
      ) : documents.length > 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">File Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Classification</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Uploaded</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => {
                const docType = (doc.doc_type ?? 'other') as DocType
                return (
                  <tr key={doc.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900 truncate max-w-xs">{doc.file_name}</p>
                      {doc.file_size_bytes && <p className="text-xs text-slate-400">{formatBytes(doc.file_size_bytes)}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      {doc.doc_type ? (
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${DOC_TYPE_BADGE[docType] ?? DOC_TYPE_BADGE.other}`}>
                          {doc.doc_type}
                        </span>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{doc.classification ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(doc.uploaded_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownload(doc)}
                          disabled={downloading === doc.id}
                          className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
                          title="Download"
                        >
                          {downloading === doc.id ? <Loader2 size={13} className="animate-spin text-slate-400" /> : <Download size={13} className="text-slate-400" />}
                        </button>
                        {confirmDeleteId === doc.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-red-600 font-medium">Delete?</span>
                            <button onClick={() => handleDelete(doc.id)} disabled={deletingId === doc.id} className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                              {deletingId === doc.id ? '…' : 'Yes'}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 transition-colors">
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(doc.id)} className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 transition-colors" title="Delete">
                            <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
