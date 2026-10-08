'use client'

/**
 * The paperwork of one vehicle.
 *
 * ⚠ FILED AGAINST THE LEGAL ENTITY, NOT THE DEAL — see src/lib/spvs/documents.ts
 * for why. The consequence on screen is that a vehicle with no `entity_id` has
 * nowhere to put a document, and that is said in words rather than shown as an
 * empty list: an empty list reads as "there is no operating agreement", which is
 * the one wrong answer.
 */

import { useRef, useState } from 'react'
import { FileText, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { formatDate, enumLabel } from '@/lib/utils/constants'
import { downloadDocument, viewDocument } from '@/lib/utils/document-links'
import { VEHICLE_DOCUMENT_PROMPTS, type VehicleDocument } from '@/lib/spvs/documents'

interface VehicleDocumentsProps {
  /** The vehicle's legal entity. Null means it has not been formed yet. */
  entityId: string | null
  vehicleLabel: string
  documents: VehicleDocument[]
  canEdit: boolean
  /** True when the owning project is confidential — see the note below. */
  dealIsConfidential: boolean
}

export default function VehicleDocuments({
  entityId,
  vehicleLabel,
  documents,
  canEdit,
  dealIsConfidential,
}: VehicleDocumentsProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function upload(file: File) {
    if (!entityId) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // The entity, never the project: the paperwork belongs to the LLC and
      // outlives the deal. `doc_type` is the vehicle's own vocabulary so the
      // knowledge base can tell an operating agreement from a bid document.
      form.append('entity_id', entityId)
      form.append('doc_type', 'entity_formation')
      form.append('extract_ai', 'true')
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(error ?? 'That did not upload')
        return
      }
      toast.success(`${file.name} filed against ${vehicleLabel}`)
      router.refresh()
    } catch {
      toast.error('That did not upload')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (!entityId) {
    return (
      <div className="rounded-md bg-muted/30 p-3">
        <p className="label-caps text-muted-foreground">Documents</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This vehicle has no legal entity yet, so there is nowhere to file its paperwork. Its
          documents belong to the company once it is formed — they outlive the deal and follow the
          entity — so link it under “In the org chart as”, or create the entity first.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-caps text-muted-foreground">
          Documents{documents.length > 0 ? ` · ${documents.length}` : ''}
        </p>
        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              // Extensions as well as the mime types: `accept` on a type alone
              // is not sufficient on macOS/iOS (§12, 09-01).
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <Button
              size="xs"
              variant="outline"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
              Add a document
            </Button>
          </>
        ) : null}
      </div>

      {documents.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Nothing filed against this entity yet. {VEHICLE_DOCUMENT_PROMPTS.join(', ')} are what
          usually live here.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {documents.map((doc) => (
            <li key={doc.id} className="relative">
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="truncate text-left text-xs font-medium outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                    onClick={() => void viewDocument(`/api/documents/${doc.id}`, doc.mimeType)}
                  >
                    {doc.fileName}
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    {/* Never print a stored enum at a reader (§12). */}
                    {doc.docType ? `${enumLabel(doc.docType)} · ` : ''}
                    {doc.uploadedAt ? formatDate(doc.uploadedAt) : 'date unknown'}
                  </p>
                  {doc.summary ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/90">
                      {doc.summary}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Download ${doc.fileName}`}
                  onClick={() => void downloadDocument(`/api/documents/${doc.id}`)}
                >
                  <Upload className="size-3 rotate-180" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        ⚠ SAYS WHAT CONTAINMENT IT DOES *NOT* HAVE. An entity-filed document has
        `project_id` NULL, and the confidential-project scrub works by project
        id — so these files stay visible on the entity's own page and to
        portfolio retrieval even while the deal is protected. True of every
        entity document and not introduced here, but this is the screen where
        someone is deciding where to put a cap table, so it is said here rather
        than discovered later.
      */}
      {dealIsConfidential ? (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          This deal is protected, but these documents are filed against the legal entity rather
          than the project — so they remain readable on the entity’s own page and to portfolio
          search. Keep anything that must stay contained on the project’s Documents tab.
        </p>
      ) : null}
    </div>
  )
}
