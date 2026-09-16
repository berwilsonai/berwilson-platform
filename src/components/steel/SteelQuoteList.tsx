'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, FileText, Loader2, Download } from 'lucide-react'

import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { formatMoney, formatDate } from '@/lib/utils/constants'
import { formatSqft } from '@/lib/utils/steel'
import {
  QUOTE_STATUS_BADGE,
  QUOTE_STATUS_LABELS,
  quoteLabel,
  quoteStatus,
} from '@/lib/utils/steel-quotes'
import type { ReadinessItem } from '@/lib/steel/quote-readiness'
import { downloadDocument, viewDocument } from '@/lib/utils/document-links'

export interface QuoteRow {
  id: string
  quote_number: string
  revision: number
  status: string
  issued_at: string | null
  valid_until: string | null
  total: number | null
  square_feet: number | null
  below_floor: boolean
  drive_file_url: string | null
  document_id: string | null
  created_at: string | null
}

interface Props {
  dealId: string
  quotes: QuoteRow[]
  blockers: ReadinessItem[]
  warnings: ReadinessItem[]
  /** Whether this viewer may approve a below-floor quote for issue. */
  canApprove: boolean
  templateMissing: boolean
}

export function SteelQuoteList({ dealId, quotes, blockers, warnings, canApprove, templateMissing }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const ready = blockers.length === 0 && !templateMissing

  async function generate() {
    setBusy('generate')
    try {
      const res = await fetch('/api/steel/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: dealId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Generation failed')
      toast.success(
        json.quote.belowFloor
          ? `${quoteLabel(json.quote.quoteNumber, json.quote.revision)} generated as DRAFT — needs approval before it can be issued.`
          : `${quoteLabel(json.quote.quoteNumber, json.quote.revision)} generated.`
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setBusy(null)
    }
  }

  async function issue(quote: QuoteRow) {
    setBusy(quote.id)
    try {
      const res = await fetch(`/api/steel/quotes/${quote.id}/issue`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not issue the quote')
      toast.success(`${quoteLabel(quote.quote_number, quote.revision)} issued.`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not issue the quote')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="label-caps text-muted-foreground">Generate a quote</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Produces the standard prefab steel quote as a PDF, stores it on this deal, and puts
              a copy in the deal&rsquo;s Drive folder. Takes about ten seconds.
            </p>
          </div>
          <Button onClick={generate} disabled={!ready || busy !== null} className="h-9 shrink-0">
            {busy === 'generate' ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <FileText className="size-4" /> Generate Quote
              </>
            )}
          </Button>
        </div>

        {templateMissing && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            The quote template has not been created yet. An admin needs to seed it before any quote
            can be generated.
          </p>
        )}

        {/* The button's disabled state and these reasons come from the same
            readiness function, so they cannot disagree. */}
        {blockers.length > 0 && (
          <div className="mt-3 rounded-md bg-muted/30 p-3">
            <p className="label-caps text-muted-foreground">Add before quoting</p>
            <ul className="mt-2 space-y-1.5">
              {blockers.map((b) => (
                <li key={b.field + b.label} className="text-xs">
                  <span className="font-medium text-foreground">{b.label}</span>
                  <span className="text-muted-foreground"> — {b.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mt-3 rounded-md bg-muted/30 p-3">
            <p className="label-caps flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" /> Worth checking
            </p>
            <ul className="mt-2 space-y-1.5">
              {warnings.map((w) => (
                <li key={w.field + w.label} className="text-xs">
                  <span className="font-medium text-foreground">{w.label}</span>
                  <span className="text-muted-foreground"> — {w.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader label="Quotes" count={quotes.length} />
        {quotes.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No quotes yet. Generating one creates a numbered PDF you can send.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {quotes.map((q) => {
              const status = quoteStatus(q.status)
              return (
                <li key={q.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium tnum">
                        {quoteLabel(q.quote_number, q.revision)}
                      </span>
                      <Chip tone={QUOTE_STATUS_BADGE[status]}>{QUOTE_STATUS_LABELS[status]}</Chip>
                      {q.below_floor && (
                        <Chip tone="bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-900">
                          Below floor
                        </Chip>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground tnum">
                      {formatMoney(q.total)} · {formatSqft(q.square_feet)}
                      {q.issued_at ? ` · issued ${formatDate(q.issued_at)}` : ''}
                      {q.valid_until ? ` · valid to ${formatDate(q.valid_until)}` : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {q.document_id && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => viewDocument(`/api/steel/documents/${q.document_id}`, 'application/pdf')}
                        >
                          <FileText className="size-4" /> PDF
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Download"
                          onClick={() => downloadDocument(`/api/steel/documents/${q.document_id}`)}
                        >
                          <Download className="size-4" />
                        </Button>
                      </>
                    )}
                    {q.drive_file_url && (
                      <a
                        href={q.drive_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Google Docs"
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    {status === 'draft' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy !== null || (q.below_floor && !canApprove)}
                        title={
                          q.below_floor && !canApprove
                            ? 'Priced below the $30/SF floor — an admin or executive has to approve it.'
                            : undefined
                        }
                        onClick={() => issue(q)}
                      >
                        {busy === q.id ? <Loader2 className="size-4 animate-spin" /> : null}
                        {q.below_floor && !canApprove ? 'Needs approval' : 'Issue'}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Wording, inclusions, exclusions and payment terms come from the quote template in Drive.
        Edit them there and every quote generated afterwards picks up the change — no deploy needed.
      </p>
    </div>
  )
}
