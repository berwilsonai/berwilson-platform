'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import EmptyState from '@/components/shared/EmptyState'
import PasteInput from '@/components/shared/PasteInput'
import RecordingUpload from '@/components/records/RecordingUpload'
import ExtractedItems, { hasExtractedItems } from '@/components/shared/ExtractedItems'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import type { OpportunityNote } from '@/lib/supabase/types'

/**
 * An opportunity's progress notes — the SAME composer and the same card the
 * project Updates tab uses.
 *
 * ⚠ IT WAS A PLAIN TEXTAREA POSTING TO ITS OWN ROUTE, AND THAT WAS THE WHOLE
 * BUG. The text was embedded, so Ber AI could find it, and nothing else
 * happened: no summary, no risks, no decisions, and — the part that actually
 * cost something — no TASKS. The identical paragraph typed on a project ran
 * `/api/ai/extract` and put its action items on the board. Both now go through
 * `PasteInput` → `/api/updates/save` → `logEntry`, one pass with a target
 * (§12), and "Save as-is" keeps the instant path this tab used to be.
 */

function formatWhen(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function NoteCard({ note }: { note: OpportunityNote }) {
  const [expanded, setExpanded] = useState(false)
  const extracted = hasExtractedItems(note)
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">{note.author || 'Note'}</span>
          <ConfidenceBadge confidence={note.confidence} />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{formatWhen(note.created_at)}</span>
      </div>

      {/* The model's read leads when there is one, with the text the human
          actually wrote underneath — the same order as an update's card. */}
      {note.summary && (
        <div className="px-4 pb-3">
          <p className="text-sm text-foreground leading-relaxed">{note.summary}</p>
        </div>
      )}

      {extracted && (
        <div className="border-t border-border px-4 py-3">
          <ExtractedItems
            waitingOn={note.waiting_on}
            risks={note.risks}
            decisions={note.decisions}
          />
        </div>
      )}

      {/* ⚠ The text the human wrote is the RECORD and the summary is derived
          from it, so it is always reachable — but collapsed behind a
          disclosure once there is a summary above it, matching an update's
          card. With no summary it is the only content and leads. */}
      {note.summary ? (
        <div className="border-t border-border px-4 py-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            What I wrote
          </button>
          {expanded && (
            <p className="mt-2 rounded-md bg-muted p-3 text-xs max-h-64 overflow-y-auto whitespace-pre-wrap text-foreground leading-relaxed">
              {note.body}
            </p>
          )}
        </div>
      ) : (
        <div className="border-t border-border px-4 py-3">
          <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
        </div>
      )}
    </Panel>
  )
}

interface OpportunityNotesProps {
  opportunityId: string
  notes: OpportunityNote[]
  /**
   * Open the composer on arrival — `?new=1`, which is how `RecordLogMenu` in
   * the record header gets here.
   */
  startNew?: boolean
}

/**
 * ⚠ SPLIT FROM ITS ROUTER WRAPPER SO IT CAN BE RENDER-CHECKED. A record page
 * is behind auth, so a curl returns the same redirect whether the page answers
 * or throws (§12) — the only honest check is to render the component, and
 * `useRouter()` throws "invariant expected app router to be mounted" outside a
 * request. Same split `/attention`'s list needed on 10-17, same reason.
 */
export function OpportunityNotesView({
  opportunityId,
  notes,
  startNew = false,
  onSaved,
}: OpportunityNotesProps & { onSaved: () => void }) {
  const [showComposer, setShowComposer] = useState(startNew)

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Progress notes ({notes.length})
        </h2>
        <button
          onClick={() => setShowComposer((v) => !v)}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
        >
          <Plus size={12} />
          Log a note
        </button>
      </div>

      {showComposer && (
        <>
          <Panel className="p-4">
            <PasteInput
              target={{ kind: 'opportunity', id: opportunityId }}
              onSaved={onSaved}
              autoFocus
            />
          </Panel>
          {/*
            ⚠ THE SAME COMPONENT THE PROJECT SIDE USES, not a thinner copy. The
            opportunity half of this app has repeatedly received the lesser
            version of a project feature — a typed note went unextracted here
            for months (10-18) — so the recording door is literally the same
            file with a different target.
          */}
          <RecordingUpload target={{ kind: 'opportunity', id: opportunityId }} onDone={onSaved} />
        </>
      )}

      {notes.length === 0 && !showComposer ? (
        <EmptyState
          icon={MessageSquare}
          title="No notes yet"
          description="Type progress, a call, or a decision. Ber AI pulls out the tasks, risks and decisions — or save it exactly as you wrote it."
          action={
            <button
              onClick={() => setShowComposer(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground elev-1 text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              <Plus size={14} />
              Log the first note
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The wrapper the page renders — the one thing that needs the router. */
export default function OpportunityNotes(props: OpportunityNotesProps) {
  const router = useRouter()
  return <OpportunityNotesView {...props} onSaved={() => router.refresh()} />
}
