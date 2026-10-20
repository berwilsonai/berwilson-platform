'use client'

import { useState } from 'react'
import { MessageSquare, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import EmptyState from '@/components/shared/EmptyState'
import SourceTag from '@/components/shared/SourceTag'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import PasteInput from '@/components/shared/PasteInput'
import RecordingUpload from '@/components/records/RecordingUpload'
import ExtractedItems, { hasExtractedItems } from '@/components/shared/ExtractedItems'
import UpdateEditModal from '@/components/projects/UpdateEditModal'
import type { Update } from '@/lib/supabase/types'

/** Renders a stored email (raw_content) as a styled email view with headers and body. */
function EmailBody({ raw }: { raw: string }) {
  // Split into header lines and body at the first blank line
  const lines = raw.split('\n')
  const headers: { label: string; value: string }[] = []
  let bodyStart = 0

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(Subject|From|To|CC|Date|Message-ID|Conversation-ID):\s*(.*)$/i)
    if (match) {
      headers.push({ label: match[1], value: match[2] })
    } else if (lines[i].trim() === '') {
      bodyStart = i + 1
      break
    }
  }

  const body = lines.slice(bodyStart).join('\n').trim()

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 overflow-hidden">
      {/* Email headers */}
      {headers.length > 0 && (
        <div className="border-b border-border px-3 py-2 space-y-0.5">
          {headers
            .filter((h) => ['Subject', 'From', 'To', 'CC', 'Date'].includes(h.label))
            .map((h, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-medium text-muted-foreground w-14 shrink-0">{h.label}</span>
                <span className="text-foreground break-all">{h.value}</span>
              </div>
            ))}
        </div>
      )}
      {/* Email body */}
      <pre className="px-3 py-2 text-xs max-h-64 overflow-y-auto whitespace-pre-wrap text-foreground leading-relaxed">
        {body}
      </pre>
    </div>
  )
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function UpdateCard({ update, onSaved }: { update: Update; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false)

  const hasExtracted = hasExtractedItems(update)

  return (
    <Panel>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <SourceTag source={update.source} />
          <ConfidenceBadge confidence={update.confidence} />
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(update.created_at)}
          </span>
        </div>
        <UpdateEditModal updateId={update.id} onSaved={onSaved} />
      </div>

      {/* Summary */}
      {update.summary && (
        <div className="px-4 pb-3">
          <p className="text-sm text-foreground leading-relaxed">{update.summary}</p>
        </div>
      )}

      {/* ⚠ The shared renderer — an opportunity note carries the same three
          columns and renders them the same way. See ExtractedItems. */}
      {hasExtracted && (
        <div className="border-t border-border px-4 py-3">
          <ExtractedItems
            waitingOn={update.waiting_on}
            risks={update.risks}
            decisions={update.decisions}
          />
        </div>
      )}

      {/* Expandable raw content / email view */}
      {update.raw_content ? (
        <div className="border-t border-border px-4 py-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {update.source === 'email'
              ? 'View original email'
              : update.source === 'call'
                ? 'View transcript'
                : update.source === 'imessage'
                  ? 'View the messages'
                  : 'Raw content'}
          </button>
          {expanded && update.source === 'email' ? (
            <EmailBody raw={update.raw_content} />
          ) : expanded ? (
            <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
              {update.raw_content}
            </pre>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

interface UpdatesTabProps {
  projectId: string
  initialUpdates: Update[]
  /**
   * Open the composer on arrival — `?new=1`, which is how `RecordLogMenu` in
   * the record header gets here. Read on the server and passed in so the box
   * is in the first paint and the reader can start typing.
   */
  startNew?: boolean
}

export default function UpdatesTab({ projectId, initialUpdates, startNew = false }: UpdatesTabProps) {
  const [updates] = useState(initialUpdates)
  const [showPaste, setShowPaste] = useState(startNew)

  function handleSaved() {
    // Re-fetch updates from the page (simple approach: reload)
    window.location.reload()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Updates ({updates.length})
        </h2>
        <button
          onClick={() => setShowPaste(!showPaste)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus size={12} />
          Log an update
        </button>
      </div>

      {/* Paste input area */}
      {showPaste && (
        <>
          <Panel className="p-4">
            <PasteInput target={{ kind: 'project', id: projectId }} onSaved={handleSaved} autoFocus />
          </Panel>
          {/*
            The recording door, beside the typing one. ⚠ Shown with the form
            rather than always: the Drive folder is the primary path (it reads
            every export within the hour and deduces the deal), and this is the
            fallback for when deduction fails or there is no time to wait.
          */}
          <RecordingUpload target={{ kind: 'project', id: projectId }} onDone={handleSaved} />
        </>
      )}

      {/* Updates feed */}
      {updates.length === 0 && !showPaste ? (
        <EmptyState
          icon={MessageSquare}
          title="No updates yet"
          description="Type notes, or paste an email or meeting summary. Ber AI pulls out the tasks, risks and decisions — or save it exactly as you wrote it."
          action={
            <button
              onClick={() => setShowPaste(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              <Plus size={14} />
              Log the first update
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {updates.map((update) => (
            <UpdateCard key={update.id} update={update} onSaved={handleSaved} />
          ))}
        </div>
      )}
    </div>
  )
}
