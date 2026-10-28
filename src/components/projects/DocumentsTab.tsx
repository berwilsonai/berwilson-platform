'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  FileText,
  Upload,
  Download,
  Trash2,
  X,
  AlertCircle,
  Loader2,
  File,
  Archive,
  ArchiveRestore,
  FolderOpen,
  Search,
  ChevronRight,
} from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import { toast } from 'sonner'
import { viewDocument, downloadDocument, fetchDocumentText } from '@/lib/utils/document-links'
import type { Document } from '@/lib/supabase/types'
import DrivePublishButton from '@/components/shared/DrivePublishButton'
import DriveImportButton from '@/components/shared/DriveImportButton'
import DriveFolderLink from '@/components/shared/DriveFolderLink'
import { formatDate, enumLabel } from '@/lib/utils/constants'
import { shelveByFolder } from '@/lib/documents/shelve'
import { formatBytes } from '@/lib/utils/format'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The types the UPLOAD picker offers. Deliberately a short, curated list: this
 * is what a person should choose from when filing a document by hand.
 *
 * ⚠ IT IS NOT THE SET OF TYPES THAT EXIST, and must never be used as one.
 * `documents.doc_type` has no CHECK and no registry behind it — the lead
 * promoter, the Drive classifier and the mail import all write values of their
 * own — so any list written out here drifts the moment one of them learns a new
 * word. It already had: a comment below once patched in 'solicitation' and
 * 'diligence' after exactly that, and as of 2026-10-15 six more were missing
 * ('capability', 'capability_statement', 'reference', 'transcript',
 * 'site_plan', 'quote'), which is 163 live documents that could not be filtered
 * for because the filter did not know they existed.
 *
 * So the FILTER derives its chips from the documents actually on the record —
 * the rows are the registry — and only this picker reads the list.
 */
const DOC_TYPES = [
  'proposal',
  'contract',
  'drawing',
  'email',
  'report',
  'correspondence',
  'solicitation',
  'diligence',
  'other',
] as const

type DocType = (typeof DOC_TYPES)[number]

const DOC_TYPE_COLORS: Record<DocType, string> = {
  proposal: 'bg-info-surface text-info ring-info-edge',
  contract: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-purple-200 dark:ring-purple-800/60',
  drawing: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800/60',
  email: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-800/60',
  report: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 ring-teal-200 dark:ring-teal-800/60',
  correspondence: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-orange-200 dark:ring-orange-800/60',
  solicitation: 'bg-caution-surface text-caution ring-caution-edge',
  diligence: 'bg-positive-surface text-positive ring-positive-edge',
  other: 'bg-muted dark:bg-muted/40 text-muted-foreground ring-border dark:ring-border/60',
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
  onChange,
}: {
  doc: Document
  onDelete: (id: string) => void
  onChange: (doc: Document) => void
}) {
  const [downloading, setDownloading] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [retiring, setRetiring] = useState(false)

  const superseded = !!doc.superseded_at

  /**
   * Retire or restore. Retiring drops the document's chunks so Ber AI stops
   * citing it, and keeps everything else — so getting it wrong costs a
   * re-index, not a document.
   */
  async function toggleSuperseded() {
    setRetiring(true)
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ superseded: !superseded }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not update the document')

      onChange({
        ...doc,
        superseded_at: superseded ? null : new Date().toISOString(),
        // Restoring IS the undo, so the duplicate verdict goes with it — else the
        // row reads as restored and still carries "Duplicate" until a reload.
        duplicate_of: superseded ? null : doc.duplicate_of,
        superseded_reason: superseded ? null : doc.superseded_reason,
      })
      if (superseded) {
        // Its chunks were deleted on the way out, so restoring has to re-index
        // or the document comes back invisible to the thing it was hidden from.
        toast.success('Restored — re-indexing for Ber AI')
        void fetch(`/api/documents/${doc.id}/reindex`, { method: 'POST' })
      } else {
        toast.success('Retired — kept on the project, no longer used for answers')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the document')
    } finally {
      setRetiring(false)
    }
  }

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
    <div
      className={`rounded-lg border border-border bg-card px-4 py-3 space-y-2 ${superseded ? 'opacity-60' : ''}`}
    >
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
            {superseded && (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset bg-muted dark:bg-muted/40 text-muted-foreground ring-border dark:ring-border/60"
                title={doc.superseded_reason ?? 'Retired — not used to answer questions.'}
              >
                <Archive size={10} />
                {doc.duplicate_of ? 'Duplicate' : 'Retired'}
              </span>
            )}
            {/* doc_type badge */}
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeColor}`}
            >
              {/* Through enumLabel, never the raw column (§12). `capitalize`
                  rendered 'capability_statement' as "Capability_statement" —
                  the underscore printed at a reader, on 11 documents. */}
              {enumLabel(docType)}
            </span>
            {/* Where it sits in the team's Drive folder. Shown because filing
                is otherwise invisible from here, and a document in _Unsorted is
                asking someone to move it. */}
            {doc.drive_folder_path && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  doc.drive_folder_path === '_Unsorted'
                    ? 'bg-caution-surface text-caution ring-caution-edge'
                    : 'bg-muted dark:bg-muted/40 text-muted-foreground ring-border dark:ring-border/60'
                }`}
                title={
                  doc.drive_folder_path === '_Unsorted'
                    ? 'Filed to _Unsorted — the classifier was not confident enough to choose a folder. Move it in Drive.'
                    : `Filed in Drive under ${doc.drive_folder_path.trim()}`
                }
              >
                <FolderOpen size={10} />
                {doc.drive_folder_path.trim()}
              </span>
            )}
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

          {/* WHY it is retired, in place. It was only ever a `title` tooltip,
              which does not exist on a phone — and "duplicate of <which
              document>" is the whole information, not a decoration: without it
              a retired row is indistinguishable from one somebody hid by
              mistake, and the Restore button beside it has no context. */}
          {superseded && doc.superseded_reason && (
            <p className="mt-1 text-xs text-muted-foreground">{doc.superseded_reason}</p>
          )}
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
            onClick={toggleSuperseded}
            disabled={retiring}
            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-accent transition-colors disabled:opacity-50"
            title={
              superseded
                ? 'Restore — index it for Ber AI again'
                : 'Retire — keep the file, stop using it to answer questions'
            }
          >
            {retiring ? (
              <Loader2 size={14} className="animate-spin" />
            ) : superseded ? (
              <ArchiveRestore size={14} className="text-muted-foreground" />
            ) : (
              <Archive size={14} className="text-muted-foreground" />
            )}
          </button>
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
              className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-critical-surface dark:hover:bg-critical-surface/40 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} className="text-muted-foreground hover:text-critical dark:hover:text-critical" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-critical font-medium">Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="h-6 px-2 rounded text-xs font-medium bg-critical text-white hover:bg-critical transition-colors disabled:opacity-50"
              >
                {deleting ? '…' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                aria-label="Keep the document"
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
            <span className="label-caps text-muted-foreground">
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
              className="inline-flex items-center gap-1.5 h-7 px-3.5 rounded-lg bg-foreground elev-1 text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
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
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                  aria-label="Remove this file from the upload"
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
                    <p className="text-xs text-positive">Uploaded</p>
                  )}
                  {upload.status === 'error' && (
                    <p className="text-xs text-critical">{upload.error}</p>
                  )}
                </div>
                {(upload.status === 'uploading' || upload.status === 'processing') && (
                  <Loader2 size={14} className="animate-spin text-muted-foreground" />
                )}
                {upload.status === 'error' && (
                  <AlertCircle size={14} className="text-critical" />
                )}
                <button
                  onClick={() => removeUpload(i)}
                  aria-label="Remove this file from the upload"
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
  /** Drive folder this project has already been published to, if any. */
  driveFolderUrl?: string | null
  /** Set when this project came from a website deal submission — its folder
      keeps filling during diligence, so it can be pulled in on demand. */
  hasDealFolder?: boolean
  /** The team's own Drive folder, linked by hand and imported nightly. */
  sourceFolderId?: string | null
  sourceFolderUrl?: string | null
  /** Publishing is a sharing decision, so the control is admin-only. */
  canPublish?: boolean
  /**
   * The server stopped at its row limit, so this is not the whole record.
   * Said out loud rather than silently shown — a truncated list that looks
   * complete is the failure the limit exists to prevent.
   */
  truncated?: boolean
}

// ---------------------------------------------------------------------------
// Grouping and filtering
// ---------------------------------------------------------------------------

/**
 * Below this many live documents the list reads fine flat, and disclosure
 * headers over three rows are furniture. Above it, a data room needs shelves:
 * Weirton's documents tab was 187 rows in one scroll, of which 105 were the
 * same Drive folder.
 */
const GROUP_THRESHOLD = 12

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium ring-1 ring-inset transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
        active
          ? 'bg-foreground text-background ring-transparent'
          : 'bg-background text-muted-foreground ring-border hover:text-foreground hover:bg-accent'
      }`}
    >
      {label}
      <span className={active ? 'opacity-70' : 'opacity-60'}>{count}</span>
    </button>
  )
}

export default function DocumentsTab({
  projectId,
  initialDocuments,
  driveFolderUrl,
  hasDealFolder,
  sourceFolderId,
  sourceFolderUrl,
  canPublish,
  truncated,
}: DocumentsTabProps) {
  const [documents, setDocuments] = useState<Document[]>(initialDocuments)
  const [showUpload, setShowUpload] = useState(false)
  const [showRetired, setShowRetired] = useState(false)

  /**
   * The filter lives in the URL, not in component state.
   *
   * A filtered view has to be a thing you can link, reload and send to Eric —
   * a filter kept only in state is not a view (§12). It also means the back
   * button undoes a filter, which is what everyone tries first.
   */
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const typeFilter = searchParams.get('type') ?? ''
  const query = searchParams.get('q') ?? ''

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      const qs = params.toString()
      // `scroll: false` — a filter chip at the top of a long list must not
      // throw the reader back to the top of the page on every tap.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  /**
   * Retired documents are kept and still reachable, but out of the way.
   *
   * They used to render inline at 60% opacity, which made decluttering
   * self-defeating: retiring the 46 byte-identical duplicates found on
   * 2026-10-09 would have put ten dimmed rows among Myton Rail's twenty-one real
   * ones and fourteen among DUBHES's eighty. A retirement has to REMOVE the row
   * from the reading list to be worth making, while staying one click away —
   * deleting is the only version of this that cannot be undone.
   */
  const liveDocuments = documents.filter((d) => !d.superseded_at)
  const retiredDocuments = documents.filter((d) => d.superseded_at)
  const duplicateCount = retiredDocuments.filter((d) => d.duplicate_of).length

  /**
   * The chips, derived from the documents on this record rather than written
   * out — see the note on DOC_TYPES. A type nobody has used here is not offered,
   * and a type invented tomorrow appears without a code change.
   */
  const presentTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of liveDocuments) {
      const t = d.doc_type ?? 'other'
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => ({ type, count }))
  }, [liveDocuments])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return liveDocuments.filter((d) => {
      if (typeFilter && (d.doc_type ?? 'other') !== typeFilter) return false
      if (!needle) return true
      // Name and summary both: the name is often uninformative ("Business
      // Plan.docx") and the summary is where the deal is actually named.
      return (
        (d.file_name ?? '').toLowerCase().includes(needle) ||
        (d.ai_summary ?? '').toLowerCase().includes(needle) ||
        (d.drive_folder_path ?? '').toLowerCase().includes(needle)
      )
    })
  }, [liveDocuments, typeFilter, query])

  const isFiltering = !!typeFilter || !!query.trim()
  // Grouped only when there is enough to shelve, and never while filtering —
  // a filter already narrows the list, and collapsed headers over a four-row
  // result is the reader doing the work twice.
  const groups = useMemo(
    () => (filtered.length > GROUP_THRESHOLD && !isFiltering ? shelveByFolder(filtered) : null),
    [filtered, isFiltering]
  )

  function handleUploaded(doc: Document) {
    setDocuments((prev) => [doc, ...prev])
  }

  function handleChanged(doc: Document) {
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? doc : d)))
  }

  function handleDeleted(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        {/*
          ⚠ `liveDocuments`, NOT `documents`. This heading counted the
          superseded ones and every other number on the tab did not, so the
          page printed 191 here and "All 188" in the filter chip directly
          below — §12's one-quantity-one-definition failure, visible without
          scrolling.
        */}
        <h2 className="text-sm font-semibold text-foreground">
          Documents ({liveDocuments.length})
        </h2>
        <div className="flex items-center gap-2">
          {canPublish && (
            <>
              {/* Inbound: the team's own folder. Linked by hand once, then
                  imported nightly — this button is for wanting it now. */}
              <DriveFolderLink
                projectId={projectId}
                folderId={sourceFolderId ?? null}
                folderUrl={sourceFolderUrl ?? null}
              />
              {(sourceFolderId || hasDealFolder) && <DriveImportButton projectId={projectId} />}
              {/* Outbound, and only when the deal folder was not adopted as the
                  publish target — offering both there would read as two
                  destinations for one folder. */}
              {!hasDealFolder && (
                <DrivePublishButton kind="project" id={projectId} folderUrl={driveFolderUrl} />
              )}
            </>
          )}
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
          >
            <Upload size={12} />
            Upload
          </button>
        </div>
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
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground elev-1 text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              <Upload size={14} />
              Upload First Document
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Filter bar. Offered once the list is long enough to need it —
              three chips over four documents is furniture. */}
          {liveDocuments.length > GROUP_THRESHOLD && (
            <div className="space-y-2 pb-1">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setParam('q', e.target.value)}
                  placeholder="Search name, summary or folder…"
                  aria-label="Search documents"
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip
                  label="All"
                  count={liveDocuments.length}
                  active={!typeFilter}
                  onClick={() => setParam('type', '')}
                />
                {presentTypes.map(({ type, count }) => (
                  <FilterChip
                    key={type}
                    label={enumLabel(type)}
                    count={count}
                    active={typeFilter === type}
                    onClick={() => setParam('type', typeFilter === type ? '' : type)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* What the filter actually produced. Said in words, because an empty
              list under an active filter is indistinguishable from an empty
              record otherwise. */}
          {isFiltering && (
            <p className="text-xs text-muted-foreground">
              {filtered.length === 0
                ? 'No documents match. '
                : `${filtered.length} of ${liveDocuments.length} document${liveDocuments.length === 1 ? '' : 's'}. `}
              <button
                onClick={() => {
                  setParam('type', '')
                  setParam('q', '')
                }}
                className="underline hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
              >
                Clear
              </button>
            </p>
          )}

          {groups
            ? groups.map((group, i) => (
                <details
                  key={group.label}
                  // The FIRST shelf open, the rest closed — and `shelveByFolder`
                  // puts `_Unsorted` first, so what opens is the shelf asking
                  // for a decision (17 documents on Weirton, 3 on Steelton).
                  // Opening everything is the flat list again; opening nothing
                  // hides the record behind a row of headers.
                  open={i === 0}
                  className="group rounded-lg border border-border bg-card/40"
                >
                  <summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer list-none rounded-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                    <ChevronRight
                      size={14}
                      className="text-muted-foreground transition-transform group-open:rotate-90 shrink-0"
                    />
                    <FolderOpen size={13} className="text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {group.label}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {group.docs.length}
                    </span>
                  </summary>
                  <div className="space-y-3 px-3 pb-3">
                    {group.docs.map((doc) => (
                      <DocumentRow
                        key={doc.id}
                        doc={doc}
                        onDelete={handleDeleted}
                        onChange={handleChanged}
                      />
                    ))}
                  </div>
                </details>
              ))
            : filtered.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  onDelete={handleDeleted}
                  onChange={handleChanged}
                />
              ))}

          {truncated && (
            <p className="text-xs text-caution flex items-start gap-1.5">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              This record holds more documents than this list shows. Open the Drive
              folder for the complete set.
            </p>
          )}

          {retiredDocuments.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setShowRetired((v) => !v)}
                className="inline-flex items-center gap-1.5 h-9 px-2 -mx-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Archive size={12} />
                {showRetired ? 'Hide' : 'Show'} {retiredDocuments.length} retired
                {duplicateCount > 0 &&
                  ` (${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'})`}
              </button>

              {showRetired && (
                <div className="space-y-3 mt-3">
                  {retiredDocuments.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      onDelete={handleDeleted}
                      onChange={handleChanged}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
