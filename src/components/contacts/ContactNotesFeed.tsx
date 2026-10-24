'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare, Pencil, Trash2, Mic, Mail, Loader2, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import PasteInput from '@/components/shared/PasteInput'
import ExtractedItems, { hasExtractedItems } from '@/components/shared/ExtractedItems'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FIELD_CONTROL_CLASS } from '@/lib/utils/field-classes'
import type { PartyNote } from '@/lib/contacts/notes'

/**
 * A contact's running feed — every conversation we have had with this person,
 * including the ones that belong to no deal.
 *
 * ⚠ IT SITS BESIDE `relationship_notes`, NOT INSTEAD OF IT, and the pair is the
 * point. That column answers "who is this person" and is edited in place; this
 * answers "what did we say, and when". Measured 2026-10-23: 98 of 151 contacts
 * had the column filled, so it is in daily use and was carrying both jobs in one
 * textarea — which is why a networking call had nowhere to land.
 *
 * ⚠ THE COMPOSER IS `PasteInput`, THE SAME ONE A PROJECT AND AN OPPORTUNITY
 * USE. §12: a shared renderer wired to one surface is worse than no shared
 * renderer, and two paths differing only in WHERE the work lands are one pass
 * with a target parameter. So a typed note on a person gets the extraction, the
 * risks, the decisions and the follow-up tasks a typed note on a deal gets.
 */

function formatDay(value: string | null): string {
  if (!value) return ''
  // ⚠ `T00:00:00`, NEVER `new Date('YYYY-MM-DD')` — the bare form is parsed as
  // UTC and renders as the day before for anyone west of Greenwich.
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const SOURCE_LABEL: Record<PartyNote['source'], string> = {
  typed: 'Typed',
  meeting: 'From a recording',
  email: 'From correspondence',
}

function SourceChip({ note }: { note: PartyNote }) {
  if (note.source === 'typed') return null
  const Icon = note.source === 'meeting' ? Mic : Mail
  return (
    <Chip tone="neutral" className="shrink-0">
      <Icon size={10} />
      {SOURCE_LABEL[note.source]}
    </Chip>
  )
}

function NoteCard({ partyId, note }: { partyId: string; note: PartyNote }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(note.body)
  const [noteDate, setNoteDate] = useState(note.note_date ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function save() {
    if (!body.trim()) {
      toast.error('A note needs some text.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${partyId}/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, note_date: noteDate || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save')
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/contacts/${partyId}/notes/${note.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not delete')
      toast.success('Note deleted')
      setConfirmDelete(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Panel className="group">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">
            {note.author || 'Note'}
          </span>
          <SourceChip note={note} />
          <ConfidenceBadge confidence={note.confidence} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground tnum">{formatDay(note.note_date)}</span>
          {/* ⚠ `group-focus-within`, NOT `group-focus-visible` (§12): these are
              BUTTONS, so the thing that takes focus is a child of the group and
              not the group itself — and a hover-only control does not exist on a
              phone or to a keyboard. */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-muted-foreground hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
              title="Edit this note"
            >
              {editing ? <X size={13} /> : <Pencil size={13} />}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-muted-foreground hover:text-destructive outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
              title="Delete this note"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="px-4 py-3 space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className={`${FIELD_CONTROL_CLASS} min-h-[8rem] py-2`}
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={noteDate}
              onChange={(e) => setNoteDate(e.target.value)}
              className={`${FIELD_CONTROL_CLASS} w-auto`}
              aria-label="When this conversation happened"
            />
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          {note.summary && note.summary !== note.body && (
            <div className="px-4 pt-3">
              <p className="text-sm text-foreground leading-relaxed">{note.summary}</p>
            </div>
          )}
          <div className="px-4 py-3">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {note.body}
            </p>
          </div>
          {hasExtractedItems(note) && (
            <div className="border-t border-border px-4 py-3">
              <ExtractedItems
                waitingOn={note.waiting_on}
                risks={note.risks}
                decisions={note.decisions}
              />
            </div>
          )}
          {note.meeting_id && (
            <div className="border-t border-border px-4 py-2">
              <Link
                href={`/intake?tab=meeting`}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <Mic size={11} />
                The recording this came from
              </Link>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this note?"
        description="The conversation stays in the activity log — this removes it from the contact's feed and from what Ber AI can quote."
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={remove}
        destructive
      />
    </Panel>
  )
}

export default function ContactNotesFeed({
  partyId,
  partyName,
  notes,
}: {
  partyId: string
  partyName: string
  notes: PartyNote[]
}) {
  const router = useRouter()

  return (
    <div className="space-y-5">
      {/* ⚠ THE COMPOSER IS ABOVE THE FEED AND IS NEVER COUNT-GATED. §12: a
          surface hidden because it is empty is hidden exactly when somebody
          needs to fill it — 17 of 19 projects had no meeting, so the only door
          to logging one sat under "More". */}
      <PasteInput target={{ kind: 'contact', id: partyId }} onSaved={() => router.refresh()} />

      {notes.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={`No conversations logged with ${partyName} yet`}
          description="Type one above, or let a recording do it — a call this contact is named on files its recap here automatically, whether or not it belongs to a deal."
        />
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <NoteCard key={note.id} partyId={partyId} note={note} />
          ))}
        </div>
      )}
    </div>
  )
}
