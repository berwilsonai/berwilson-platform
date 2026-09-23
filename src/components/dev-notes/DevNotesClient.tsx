'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Bug,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatDate } from '@/lib/utils/constants'
import type { DevNoteRow } from '@/lib/dev-notes/queries'
import {
  DEV_NOTE_KINDS,
  DEV_NOTE_KIND_BADGE,
  DEV_NOTE_KIND_SHORT,
  DEV_NOTE_PRIORITIES,
  DEV_NOTE_PRIORITY_BADGE,
  DEV_NOTE_PRIORITY_LABELS,
  DEV_NOTE_PRIORITY_RANK,
  DEV_NOTE_STATUSES,
  DEV_NOTE_STATUS_BADGE,
  DEV_NOTE_STATUS_LABELS,
  devNoteKind,
  devNotePriority,
  devNoteStatus,
  isDevNoteClosed,
  type DevNoteStatus,
} from '@/lib/utils/dev-notes'

interface Props {
  notes: DevNoteRow[]
  isAdmin: boolean
  /** The viewer's team_member id — decides which rows they may edit. */
  teamMemberId: string | null
  /** Row to expand on mount, from `?note=<id>` (notification deep link). */
  initialOpenNoteId?: string
}

/**
 * The reports ledger. Open work at the top, settled work collapsed below.
 *
 * ⚠ CHECKING OFF IS THE POINT, so the control is a checkbox on the row rather
 * than a status dropdown buried in a detail view: a report that takes four
 * clicks to close is a report that stays open. Optimistic with revert-and-toast
 * on failure — a row that silently un-ticks reads as handled when it was not.
 */
export default function DevNotesClient({ notes, isAdmin, teamMemberId, initialOpenNoteId }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(notes)
  const [expanded, setExpanded] = useState<string | null>(initialOpenNoteId ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [kindFilter, setKindFilter] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState<DevNoteRow | null>(null)

  const canEdit = (note: DevNoteRow) =>
    isAdmin || (!!teamMemberId && note.reporter_id === teamMemberId)

  const { open, closed } = useMemo(() => {
    const filtered = kindFilter ? rows.filter((n) => n.kind === kindFilter) : rows
    const open = filtered
      .filter((n) => !isDevNoteClosed(n.status))
      // High priority first, then newest — the triage order, not arrival order.
      .sort((a, b) => {
        const p =
          DEV_NOTE_PRIORITY_RANK[devNotePriority(a.priority)] -
          DEV_NOTE_PRIORITY_RANK[devNotePriority(b.priority)]
        if (p !== 0) return p
        return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      })
    const closed = filtered
      .filter((n) => isDevNoteClosed(n.status))
      .sort((a, b) => (b.resolved_at ?? b.updated_at ?? '').localeCompare(a.resolved_at ?? a.updated_at ?? ''))
    return { open, closed }
  }, [rows, kindFilter])

  async function patch(note: DevNoteRow, body: Record<string, unknown>, successMsg?: string) {
    const before = rows
    // Optimistic — the row must move the moment it is clicked.
    setRows((prev) => prev.map((n) => (n.id === note.id ? { ...n, ...body } as DevNoteRow : n)))
    setBusy(note.id)
    try {
      const res = await fetch(`/api/dev-notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Update failed')
      setRows((prev) => prev.map((n) => (n.id === note.id ? { ...n, ...json.note } : n)))
      if (successMsg) toast.success(successMsg)
      router.refresh()
    } catch (err) {
      setRows(before)
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove(note: DevNoteRow) {
    const before = rows
    setRows((prev) => prev.filter((n) => n.id !== note.id))
    try {
      const res = await fetch(`/api/dev-notes/${note.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Report deleted')
      router.refresh()
    } catch {
      setRows(before)
      toast.error('Could not delete the report')
    }
  }

  function renderRow(note: DevNoteRow) {
    const kind = devNoteKind(note.kind)
    const status = devNoteStatus(note.status)
    const priority = devNotePriority(note.priority)
    const settled = isDevNoteClosed(status)
    const editable = canEdit(note)
    const isOpen = expanded === note.id

    return (
      <div key={note.id} className="border-b border-border last:border-0">
        <div className="flex items-start gap-3 px-4 py-3">
          {/* Check-off. The -inset-3 overlay grows the tap area to 44px
              without moving the row, so completing on a phone doesn't shift
              everything below it under the next tap. */}
          <button
            type="button"
            disabled={!editable || busy === note.id}
            onClick={() =>
              patch(
                note,
                { status: settled ? 'open' : 'done' },
                settled ? 'Reopened' : 'Checked off'
              )
            }
            aria-label={settled ? 'Reopen report' : 'Mark as done'}
            title={editable ? (settled ? 'Reopen' : 'Mark as done') : 'Only the reporter or an admin can change this'}
            className={`relative mt-0.5 size-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
              settled
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'border-muted-foreground/40 text-transparent hover:border-primary hover:text-primary/40'
            } ${editable ? '' : 'opacity-40 cursor-not-allowed'}`}
          >
            <span className="absolute -inset-3" aria-hidden />
            {busy === note.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          </button>

          <button
            type="button"
            onClick={() => setExpanded(isOpen ? null : note.id)}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <p className={`text-sm font-medium ${settled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {note.title}
              </p>
              <ChevronDown
                size={14}
                className={`shrink-0 mt-0.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={DEV_NOTE_KIND_BADGE[kind]}>{DEV_NOTE_KIND_SHORT[kind]}</Chip>
              <Chip tone={DEV_NOTE_STATUS_BADGE[status]}>{DEV_NOTE_STATUS_LABELS[status]}</Chip>
              {priority === 'high' && (
                <Chip tone={DEV_NOTE_PRIORITY_BADGE.high}>High</Chip>
              )}
              <span className="text-xs text-muted-foreground">
                {note.reporter_name ?? 'Unknown'} · {formatDate(note.created_at)}
              </span>
              {note.page_path && (
                <span className="text-xs font-mono text-muted-foreground/70 truncate max-w-[16rem]">
                  {note.page_path}
                </span>
              )}
            </div>
          </button>
        </div>

        {isOpen && (
          <div className="px-4 pb-4 pl-12 space-y-3">
            {note.body && (
              <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
            )}

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {note.page_path && (
                <div>
                  <dt className="label-caps text-muted-foreground">Reported from</dt>
                  <dd className="font-mono text-foreground break-all">{note.page_path}</dd>
                </div>
              )}
              {note.user_agent && (
                <div>
                  <dt className="label-caps text-muted-foreground">Browser</dt>
                  <dd className="text-muted-foreground break-all">{note.user_agent}</dd>
                </div>
              )}
              {note.resolved_at && (
                <div>
                  <dt className="label-caps text-muted-foreground">Settled</dt>
                  <dd className="text-foreground">
                    {formatDate(note.resolved_at)}
                    {note.resolved_by ? ` by ${note.resolved_by}` : ''}
                  </dd>
                </div>
              )}
            </dl>

            {note.resolution && (
              <div className="rounded-md bg-muted/30 p-3">
                <p className="label-caps text-muted-foreground mb-1">What was done</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{note.resolution}</p>
              </div>
            )}

            {editable && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  value={status}
                  onChange={(e) => patch(note, { status: e.target.value as DevNoteStatus })}
                  className="h-11 sm:h-8 px-2 rounded-md border border-border bg-background text-xs"
                  aria-label="Status"
                >
                  {DEV_NOTE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {DEV_NOTE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>

                {/* Priority is admin-only: everyone's bug is urgent, and a
                    triage field anyone can set stops being a triage field. */}
                {isAdmin && (
                  <select
                    value={priority}
                    onChange={(e) => patch(note, { priority: e.target.value })}
                    className="h-11 sm:h-8 px-2 rounded-md border border-border bg-background text-xs"
                    aria-label="Priority"
                  >
                    {DEV_NOTE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {DEV_NOTE_PRIORITY_LABELS[p]} priority
                      </option>
                    ))}
                  </select>
                )}

                {isAdmin && (
                  <ResolutionEditor
                    value={note.resolution ?? ''}
                    onSave={(text) => patch(note, { resolution: text }, 'Saved')}
                  />
                )}

                {settled && (
                  <Button variant="ghost" size="sm" onClick={() => patch(note, { status: 'open' }, 'Reopened')}>
                    <RotateCcw size={13} /> Reopen
                  </Button>
                )}

                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive ml-auto"
                    onClick={() => setConfirmDelete(note)}
                  >
                    <Trash2 size={13} /> Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => window.dispatchEvent(new Event('open-dev-note'))}>
          <Plus size={14} /> New report
        </Button>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="h-11 sm:h-8 px-2 rounded-md border border-border bg-background text-xs"
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          {DEV_NOTE_KINDS.map((k) => (
            <option key={k} value={k}>
              {DEV_NOTE_KIND_SHORT[k]}
            </option>
          ))}
        </select>
      </div>

      <Panel>
        <PanelHeader label="Open" count={open.length} />
        {open.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Bug size={20} className="mx-auto text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {rows.length === 0
                ? 'No reports yet. Use “Report an issue” in the bottom-left corner of any page.'
                : 'Nothing open — everything reported has been settled.'}
            </p>
          </div>
        ) : (
          <div>{open.map(renderRow)}</div>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel>
          <PanelHeader label="Settled" count={closed.length}>
            <button
              onClick={() => setShowClosed((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showClosed ? 'Hide' : 'Show'}
            </button>
          </PanelHeader>
          {showClosed && <div>{closed.map(renderRow)}</div>}
        </Panel>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Delete this report?"
        description="Settling it as Done or Won't do keeps the record of what was reported. Delete only removes duplicates and mistakes — it cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (confirmDelete) await remove(confirmDelete)
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

/** Inline editor for the "what was done" note the reporter reads. */
function ResolutionEditor({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        {value ? 'Edit outcome' : 'Add outcome'}
      </Button>
    )
  }
  return (
    <div className="w-full flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        autoFocus
        placeholder="What was done about it — the reporter sees this."
        className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-base sm:text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            onSave(text.trim())
            setEditing(false)
          }}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText(value)
            setEditing(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
