'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, FileText, Loader2, Sparkles } from 'lucide-react'

import { Panel, PanelHeader } from '@/components/ui/card'
import { Field, FormActions, Select, Textarea } from '@/components/ui/field'
import { COUNSEL_NOTICE, composeKind, composeKindList } from '@/lib/documents/compose-kinds'
import type { RecordKind } from '@/lib/records/log-menu'

/**
 * BER AI WRITES A DOCUMENT ON THIS DEAL.
 *
 * The measured gap this closes: of 78 questions ever asked of the agent, 20
 * wanted a document and none got one — the GridEdge offer was asked six times
 * and answered into a chat dock each time. The model could always write it;
 * there was nowhere to put it.
 *
 * ⚠ THE WAIT IS STATED, NOT HIDDEN BEHIND A SPINNER. A compose is a local model
 * call of minutes (median Ber AI answer 73s, p90 455s). The honest thing is to
 * say so and to say that a text will arrive, because the one behaviour that
 * must not be encouraged is sitting here watching it.
 */

interface ComposeResponse {
  requestId?: string
  status?: 'ready' | 'failed'
  title?: string | null
  documentId?: string | null
  driveFileUrl?: string | null
  contained?: boolean
  texted?: boolean
  error?: string | null
  evidenceTruncated?: number
}

interface Props {
  kind: RecordKind
  recordId: string
  /** True when the record is protected — nothing may leave the box. */
  confidential?: boolean
}

export default function ComposeDocument({ kind, recordId, confidential = false }: Props) {
  const router = useRouter()
  const kinds = composeKindList()

  const [documentKind, setDocumentKind] = useState(kinds[0]?.key ?? '')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ComposeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const spec = composeKind(documentKind)
  const ready = instructions.trim().length >= 10 && !!spec

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/documents/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [kind === 'project' ? 'project_id' : 'opportunity_id']: recordId,
          document_kind: documentKind,
          instructions: instructions.trim(),
        }),
      })
      const data: ComposeResponse = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `The request failed (${res.status}).`)
        return
      }
      setResult(data)
      if (data.status === 'ready') {
        setInstructions('')
        // §12: an optimistic client mutation with no router.refresh() leaves
        // every server-rendered count lying until the tab is reloaded — the
        // document list on this page is server-rendered.
        router.refresh()
      }
    } catch (err) {
      // A browser that gave up waiting has NOT cancelled the work: the handler
      // runs to completion server-side and the text still arrives. Saying so is
      // the difference between "it failed" and "it is still coming".
      setError(
        err instanceof Error && /fetch|network|aborted/i.test(err.message)
          ? 'The browser stopped waiting, but the document is still being written — it will arrive by text, and appear on this tab.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <PanelHeader label={<><Sparkles size={12} className="inline mr-1" />Have Ber AI write one</>} />

      <div className="p-4 space-y-3">
        <Field label="What kind" id="compose-kind">
          <Select
            id="compose-kind"
            value={documentKind}
            onChange={(e) => setDocumentKind(e.target.value)}
            disabled={busy}
          >
            {/* Derived from the registry — never spelled out here (§12). */}
            {kinds.map(({ key, spec: s }) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        {spec && <p className="text-xs text-muted-foreground">{spec.description}</p>}

        <Field label="What it should say" id="compose-instructions">
          <Textarea
            id="compose-instructions"
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={busy}
            placeholder={
              kind === 'project'
                ? 'e.g. an offer that pays a small amount up front with the balance on milestones, preserving the existing contracts and key staff'
                : 'e.g. a one-pager explaining the site build-out for someone who has not seen the deal'
            }
          />
        </Field>

        <p className="text-xs text-muted-foreground">
          It reads this deal&apos;s correspondence, meetings and documents. Figures come
          from the record — anything it cannot source is refused rather than
          guessed, so put a number in the instruction if you are setting it
          yourself.
        </p>

        {spec?.legal === 'needs_counsel' && (
          <p className="text-xs text-caution">{COUNSEL_NOTICE}</p>
        )}

        {confidential && (
          <p className="text-xs text-muted-foreground">
            This project is protected, so the document stays on the record — no
            Google Doc, and no text.
          </p>
        )}

        <FormActions>
          <button
            type="button"
            onClick={submit}
            disabled={!ready || busy}
            className="inline-flex items-center justify-center gap-2 h-[2.75rem] px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-all elev-1"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {busy ? 'Writing…' : 'Write it'}
          </button>
        </FormActions>

        {busy && (
          <p className="text-xs text-muted-foreground">
            This takes a few minutes. You can leave this page — it keeps going,
            and you will get a text with the link when it is done.
          </p>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
        )}

        {result?.status === 'failed' && result.error && (
          <div className="rounded-md bg-caution-surface p-3 text-xs text-caution">
            {result.error}
          </div>
        )}

        {result?.status === 'ready' && (
          <div className="rounded-md bg-muted/30 p-3 space-y-1.5">
            <p className="text-sm font-medium">{result.title ?? 'Document written'}</p>
            <p className="text-xs text-muted-foreground">
              Filed on this record{result.texted ? ' — and texted to you' : ''}.
            </p>
            {result.driveFileUrl && (
              <a
                href={result.driveFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:underline"
              >
                Open the Google Doc
                <ExternalLink size={11} />
              </a>
            )}
            {result.evidenceTruncated ? (
              // A thin document should be explicable rather than mysterious.
              <p className="text-xs text-muted-foreground">
                {result.evidenceTruncated} older item
                {result.evidenceTruncated === 1 ? '' : 's'} did not fit in what it read.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Panel>
  )
}
