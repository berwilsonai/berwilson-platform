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
  MinusCircle,
  RefreshCw,
  Download,
  FolderInput,
  Archive,
} from 'lucide-react'
import { toast } from 'sonner'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import { viewDocument, downloadDocument, fetchDocumentText } from '@/lib/utils/document-links'
import type { CompanyKnowledgeDoc, SetAsideDoc } from '@/lib/documents/unfiled'

export type FilingTarget = { kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string }

interface CompanyKnowledgeBaseProps {
  documents: CompanyKnowledgeDoc[]
  setAside: SetAsideDoc[]
  targets: FilingTarget[]
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

export default function CompanyKnowledgeBase({ documents, setAside, targets }: CompanyKnowledgeBaseProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [docType, setDocType] = useState<string>('capability_statement')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reindexingId, setReindexingId] = useState<string | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [filingId, setFilingId] = useState<string | null>(null)
  /** Which row has its record picker open. */
  const [pickerId, setPickerId] = useState<string | null>(null)

  /**
   * File a document onto a record, or set it aside.
   *
   * Both go through one route because they are the same act from the reader's
   * chair: deciding where this document belongs, with "nowhere" as a valid
   * answer. Setting aside keeps the file and drops only its chunks, so it is
   * reversible — which is what makes it safe to do in bulk.
   */
  async function fileTo(doc: CompanyKnowledgeDoc, target: FilingTarget) {
    setFilingId(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/refile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { kind: target.kind, id: target.id } }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? 'Could not file the document')
        return
      }
      toast.success(
        body?.chunks
          ? `Filed on ${target.name} — ${body.chunks} passage${body.chunks === 1 ? '' : 's'} moved with it`
          : `Filed on ${target.name}`
      )
      setPickerId(null)
      router.refresh()
    } finally {
      setFilingId(null)
    }
  }

  async function setAsideDoc(doc: CompanyKnowledgeDoc) {
    setFilingId(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/refile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exclude: true,
          reason: doc.reason ?? 'Set aside from the company knowledge base by hand.',
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? 'Could not set the document aside')
        return
      }
      toast.success(
        body?.chunks
          ? `Set aside — ${body.chunks} passage${body.chunks === 1 ? '' : 's'} left the corpus`
          : 'Set aside'
      )
      router.refresh()
    } finally {
      setFilingId(null)
    }
  }

  async function handleView(doc: CompanyKnowledgeDoc) {
    setViewingId(doc.id)
    try {
      const ok = await viewDocument(`/api/documents/${doc.id}`, doc.mimeType)
      if (!ok) toast.error('Could not open the document. Please try again.')
    } finally {
      setViewingId(null)
    }
  }

  async function handleDownload(doc: CompanyKnowledgeDoc) {
    setDownloadingId(doc.id)
    try {
      const ok = await downloadDocument(`/api/documents/${doc.id}`)
      if (!ok) toast.error('Could not generate download link. Please try again.')
    } finally {
      setDownloadingId(null)
    }
  }

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

  async function handleReindex(doc: CompanyKnowledgeDoc) {
    setReindexingId(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/reindex`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.status === 'complete') {
        toast.success(`${doc.fileName} indexed`)
      } else if (res.ok && body?.status === 'skipped') {
        toast.info(`${doc.fileName} — this file type can't be read for AI search`)
      } else {
        toast.error(`Indexing failed${body?.error ? `: ${body.error}` : ''} — try re-uploading the file`)
      }
    } catch {
      toast.error('Indexing failed — is the server reachable?')
    }
    setReindexingId(null)
    router.refresh()
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
        <h2 className="label-caps text-muted-foreground">
          Knowledge Base
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Ber Wilson&apos;s own documents — capability statements, past performance, resumes,
          credentials, safety record. Ber AI reads these when answering portfolio questions and when
          assessing whether to pursue an RFP, so a document about one deal belongs on that deal
          instead: <strong className="font-medium text-foreground/80">file it on the record</strong>{' '}
          and its passages move with it, or{' '}
          <strong className="font-medium text-foreground/80">set it aside</strong> to keep the file
          without answering questions from it.
        </p>
      </div>

      {/* Upload area */}
      <div className="rounded-xl border border-border bg-card p-3 elev-1 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground">Document type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <p className="text-xs text-muted-foreground mt-1">PDF, Word (.docx), text, CSV</p>
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
              className="group rounded-xl border border-border bg-card px-4 py-3 elev-1"
            >
              <div className="flex items-start gap-3">
                <FileText size={18} className="shrink-0 mt-0.5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleView(doc)}
                      disabled={viewingId === doc.id}
                      className="max-w-full text-left text-sm font-medium text-foreground truncate hover:underline disabled:opacity-50"
                      title="Open document"
                    >
                      {doc.fileName}
                    </button>
                    {doc.docType && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
                        {label(doc.docType)}
                      </span>
                    )}
                    <EmbedStatus status={doc.embeddingStatus} />
                    {/*
                      How much of the searchable corpus this one document is.
                      Company passages widen every project-scoped question, so
                      the footprint is the fact that decides whether a document
                      is worth moving — and it was nowhere on screen.
                    */}
                    {doc.chunks > 0 && (
                      <span
                        className="text-[11px] text-muted-foreground"
                        title={`${doc.chunks} indexed passage${doc.chunks === 1 ? '' : 's'} — Ber AI can retrieve these when answering`}
                      >
                        {doc.chunks} passage{doc.chunks === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {/* WHICH nominated Drive folder this came off. */}
                  {doc.folderPath && (
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate" title={doc.folderPath}>
                      {doc.folderPath}
                    </p>
                  )}
                  {doc.aiSummary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.aiSummary}</p>
                  )}
                </div>
                <ReadAloudButton
                  getText={async () => {
                    const text = await fetchDocumentText(doc.id)
                    if (!text) toast.info('No readable text stored for this file — open it and use the Mac\u2019s built-in reader instead.')
                    return text
                  }}
                  iconSize={15}
                  className="shrink-0 p-1.5 rounded-md hover:bg-muted"
                />
                <button
                  onClick={() => handleDownload(doc)}
                  disabled={downloadingId === doc.id}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                  aria-label="Download document"
                  title="Download"
                >
                  {downloadingId === doc.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                </button>
                {doc.embeddingStatus !== 'complete' && (
                  <button
                    onClick={() => handleReindex(doc)}
                    disabled={reindexingId === doc.id}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                    aria-label="Reindex document"
                    title="Re-run AI indexing from the stored file"
                  >
                    <RefreshCw size={15} className={reindexingId === doc.id ? 'animate-spin' : ''} />
                  </button>
                )}
                {/*
                  Delete is offered ONLY for a document that did not come from
                  Drive. Deleting a synced one looks like it works and changes
                  nothing: the row goes, the file is still in the nominated
                  folder, and tonight's sync re-imports it as new. "Set aside"
                  is the removal that holds, so it is the only one shown.
                */}
                {!doc.fromDrive && (
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deletingId === doc.id}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-red-500 transition-colors disabled:opacity-50"
                    aria-label="Delete document permanently"
                    title="Delete the file permanently. To take it out of the corpus but keep it, use Set aside."
                  >
                    {deletingId === doc.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                )}
              </div>

              {/* Filing row. Never hidden behind hover — a control that only
                  appears on hover does not exist on a phone (§12). */}
              <div className="mt-2 flex items-center gap-2 flex-wrap pl-[30px]">
                {doc.target && (
                  <button
                    onClick={() => fileTo(doc, doc.target!)}
                    disabled={filingId === doc.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    title={doc.reason ? `Ber AI: ${doc.reason}` : undefined}
                  >
                    {filingId === doc.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <FolderInput size={12} />
                    )}
                    File on {doc.target.name}
                  </button>
                )}

                {pickerId === doc.id ? (
                  <select
                    autoFocus
                    defaultValue=""
                    onChange={(e) => {
                      const t = targets.find((x) => `${x.kind}:${x.id}` === e.target.value)
                      if (t) fileTo(doc, t)
                    }}
                    onBlur={() => setPickerId(null)}
                    aria-label={`File ${doc.fileName} on a record`}
                    /* Bounded: a native select sizes to its widest option, and
                       one long project name otherwise stretches the row (§12). */
                    className="h-7 max-w-[260px] rounded-md border border-input bg-background px-2 text-[11px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="" disabled>
                      Choose a record…
                    </option>
                    {targets.map((t) => (
                      <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>
                        {t.name} ({t.kind === 'steel_deal' ? 'steel' : t.kind})
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    onClick={() => setPickerId(doc.id)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <FolderInput size={12} />
                    {doc.target ? 'File elsewhere' : 'File on a record'}
                  </button>
                )}

                <button
                  onClick={() => setAsideDoc(doc)}
                  disabled={filingId === doc.id}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  title="Take it out of the corpus and keep the file. Reversible, and the nightly Drive sync will not bring it back."
                >
                  <Archive size={12} />
                  Set aside
                </button>

                {/* Why this is proposed. The reason is what a reader can check;
                    the score is not, so it is not printed (§12). */}
                {doc.reason && !doc.target && (
                  <span className="text-[11px] text-muted-foreground/80">{doc.reason}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Set aside — a count, not nine more rows in the corpus list. */}
      {setAside.length > 0 && (
        <details className="rounded-xl border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {setAside.filter((d) => d.state === 'excluded').length} set aside,{' '}
            {setAside.filter((d) => d.state === 'retired').length} retired — not used for answers
          </summary>
          <ul className="mt-2 space-y-1">
            {setAside.map((d) => (
              <li key={d.id} className="text-[11px] text-muted-foreground flex items-start gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium">
                  {d.state === 'excluded' ? 'Set aside' : 'Retired'}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground/80">{d.fileName}</span>
                  {d.folderPath && <span className="text-muted-foreground/70"> — {d.folderPath}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
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
  if (status === 'skipped')
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
        title="This file type can't be read for AI search — the file is stored, but Ber AI won't see its contents"
      >
        <MinusCircle size={11} /> Not indexed
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
      <Clock size={11} /> Indexing…
    </span>
  )
}
