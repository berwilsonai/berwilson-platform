import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, AlertCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import AgentChat from '@/components/agent/AgentChat'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import ReferenceDocActions from '@/components/reference-docs/ReferenceDocActions'

export const metadata = { title: 'Document — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default async function DocumentReaderPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_name, mime_type, file_size_bytes, ai_summary, embedding_status, is_reference')
    .eq('id', id)
    .single()

  if (!doc || !doc.is_reference) notFound()

  const stillIndexing = doc.embedding_status === 'processing' || doc.embedding_status === 'pending'
  const notReadable = doc.embedding_status === 'skipped'
  const failed = doc.embedding_status === 'error'

  return (
    <div className="max-w-5xl space-y-5">
      <Link
        href="/intake?tab=document"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        Documents
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate">{doc.file_name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[doc.mime_type, fmtSize(doc.file_size_bytes)].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <ReferenceDocActions documentId={doc.id} mimeType={doc.mime_type} />
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-border bg-card elev-1 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Summary
          </h2>
          {doc.ai_summary && (
            <ReadAloudButton text={doc.ai_summary} className="text-muted-foreground hover:text-primary" />
          )}
        </div>
        {doc.ai_summary ? (
          <p className="text-sm text-foreground leading-relaxed">{doc.ai_summary}</p>
        ) : notReadable ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle size={15} className="text-amber-500 shrink-0" />
            This file type couldn&apos;t be read for a summary, but you can still open it above.
          </p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <AlertCircle size={15} className="text-destructive shrink-0" />
            The summary couldn&apos;t be generated. Try re-uploading the document.
          </p>
        ) : stillIndexing ? (
          <p className="text-sm text-muted-foreground">Still reading the document — refresh in a moment.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No summary available.</p>
        )}
      </div>

      {/* Q&A */}
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Ask about this document
        </h2>
        <div className="rounded-xl border border-border bg-card elev-1 h-[600px] overflow-hidden">
          <AgentChat documentId={doc.id} placeholder="Ask anything about this document…" showClear />
        </div>
      </div>
    </div>
  )
}
