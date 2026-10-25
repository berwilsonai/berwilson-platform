'use client'

/**
 * Every file off deal mail whose deal has not been decided — with a picker.
 *
 * ⚠ WHY THIS EXISTS RATHER THAN JUST THE /decide ROWS. `/decide` only ever
 * offers a row it can NAME a destination for: `matchDocument` proposes a target
 * or the row is held out, because reaching for the closest record is how real
 * evidence lands on the wrong deal (§12 — ambiguity means NO match). Measured on
 * the first live import, 4 of 4 were held: `BW MNDA (with Non-Circumvention)`
 * names no record, and neither does `Package.pdf` or `Quit Claim Deed`.
 *
 * A HUMAN can place every one of them in a second — they know which counterparty
 * the MNDA was for — so the held rows do not need a better matcher, they need a
 * PICKER. Reporting the held count on /decide and stopping there would have been
 * a number with no door, which is the black hole §12 warns about wearing a
 * tick's clothing.
 *
 * ⚠ DELIBERATELY NOT `CompanyKnowledgeBase`, THOUGH IT RENDERS THE SAME TYPE.
 * That component carries company semantics — a `DOC_TYPES` list of capability
 * statements, past performance and safety records, and a `guessType` that reads
 * file names for "cap state". None of that means anything for a counterparty's
 * term sheet, and wiring it here would put capability-evidence vocabulary on
 * deal mail. A shared renderer wired to a surface it does not fit is worse than
 * no shared renderer (§12). What IS shared is everything that matters: the
 * reader (`loadCompanyKnowledge`), the matcher (`matchDocument`) and the write
 * (`/api/documents/[id]/refile`).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { FileQuestion, Loader2, X, Search } from 'lucide-react'
import type { CompanyKnowledgeDoc } from '@/lib/documents/unfiled'
import { viewDocument } from '@/lib/utils/document-links'
import { Panel } from '@/components/ui/card'

export type FilingTarget = { kind: 'project' | 'opportunity' | 'steel_deal'; id: string; name: string }

interface Props {
  documents: CompanyKnowledgeDoc[]
  targets: FilingTarget[]
}

export default function UnparentedDocuments({ documents, targets }: Props) {
  const router = useRouter()
  const [pickerId, setPickerId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** Rows already acted on, hidden optimistically so the list visibly shrinks. */
  const [done, setDone] = useState<Set<string>>(new Set())

  async function fileTo(doc: CompanyKnowledgeDoc, target: FilingTarget) {
    setBusyId(doc.id)
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
      setDone((d) => new Set(d).add(doc.id))
      setPickerId(null)
      // ⚠ TRAILING REFRESH, NOT ONE PER ROW. The /decide badge renders in the
      // root layout and is reused across soft navigations, so without this it
      // keeps counting what has been filed (§12). Debounced by being called
      // once per action rather than once per row in a loop.
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function setAside(doc: CompanyKnowledgeDoc) {
    setBusyId(doc.id)
    try {
      const res = await fetch(`/api/documents/${doc.id}/refile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exclude: true,
          reason: doc.reason ?? 'Not a document worth keeping — set aside by hand off deal mail.',
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? 'Could not set the document aside')
        return
      }
      toast.success('Set aside — the file stays, nothing answers from it')
      setDone((d) => new Set(d).add(doc.id))
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const rows = documents.filter((d) => !done.has(d.id))

  if (rows.length === 0) {
    return (
      <Panel className="border-dashed p-8 text-center">
        <FileQuestion className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing is waiting. Every file that arrived on deal mail is on a record.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((doc) => {
        const busy = busyId === doc.id
        const picking = pickerId === doc.id
        const shown = query.trim()
          ? targets.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()))
          : targets

        return (
          <Panel key={doc.id} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => void viewDocument(doc.id)}
                  className="truncate text-left text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {doc.fileName}
                </button>
                {/* The thread's subject — usually the only thing that says
                    which deal the file is about. */}
                {doc.sourceSubject && (
                  <p className="truncate text-xs text-muted-foreground">
                    arrived on &ldquo;{doc.sourceSubject}&rdquo;
                  </p>
                )}
                {doc.aiSummary && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{doc.aiSummary}</p>
                )}
                {/* ⚠ A ZERO HERE IS THE EXPENSIVE CASE, the opposite of the
                    company queue. These are on no record, so if the text is not
                    in the mail index either, nothing can answer from the file. */}
                <p className="mt-1 text-xs text-muted-foreground">
                  {doc.mailChunks > 0
                    ? `${doc.mailChunks} passage${doc.mailChunks === 1 ? '' : 's'} searchable with its email thread · on no record`
                    : 'On no record and not indexed — nothing can answer from this file today'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {doc.target && !picking && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void fileTo(doc, doc.target as FilingTarget)}
                    className="inline-flex h-[2.25rem] items-center gap-1.5 rounded-md bg-primary px-3 text-xs text-primary-foreground outline-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    File onto {doc.target.name}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPickerId(picking ? null : doc.id)}
                  className="inline-flex h-[2.25rem] items-center rounded-md border px-3 text-xs outline-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {doc.target ? 'Another deal' : 'Choose a deal'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void setAside(doc)}
                  className="inline-flex size-[2.25rem] items-center justify-center rounded-md border text-muted-foreground outline-none disabled:opacity-50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  title="Not a document — set aside"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {picking && (
              <div className="mt-3 border-t pt-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter deals…"
                    className="h-[2.25rem] w-full rounded-md border bg-background pl-8 pr-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                  {shown.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No deal matches that.</p>
                  ) : (
                    shown.map((t) => (
                      <button
                        key={`${t.kind}:${t.id}`}
                        type="button"
                        disabled={busy}
                        onClick={() => void fileTo(doc, t)}
                        className="rounded-full border px-2.5 py-1 text-xs outline-none disabled:opacity-50 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {t.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </Panel>
        )
      })}

      <p className="pt-2 text-xs text-muted-foreground">
        Filing moves the file onto the deal and re-points its indexed passages — it never
        re-reads the document, so it is quick and reversible. Everything here is also
        counted on{' '}
        <Link href="/decide" className="underline underline-offset-2 hover:text-foreground">
          Decide
        </Link>
        , which only lists the ones with a deal already proposed.
      </p>
    </div>
  )
}
