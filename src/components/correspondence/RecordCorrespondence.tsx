'use client'

import { useCallback, useState } from 'react'
import { Mail, Loader2, Plus, X, Paperclip, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { formatDate } from '@/lib/utils/constants'

/**
 * A record's correspondence file, and the way to add to it.
 *
 * The router files only what it can prove, which leaves most mail attached to
 * nothing. That is defensible as a matching policy and indefensible as an end
 * state: a person reading a thread knows which deal it belongs to instantly.
 * "Find unfiled mail" runs the same semantic sweep the brief uses and offers
 * what it finds, so filing is one click rather than a data-entry exercise.
 */

export interface CorrespondenceThread {
  id: string
  subject: string | null
  mailbox: string | null
  last_at: string | null
  message_count: number | null
  attachment_count: number | null
  summary: string | null
  certainty?: string
  why_filed?: string | null
}

interface Props {
  recordKind: 'project' | 'opportunity' | 'steel_deal' | 'lead'
  recordId: string
  initialFiled: CorrespondenceThread[]
}

export default function RecordCorrespondence({
  recordKind,
  recordId,
  initialFiled,
}: Props) {
  const [filed, setFiled] = useState<CorrespondenceThread[]>(initialFiled)
  const [candidates, setCandidates] = useState<CorrespondenceThread[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const findUnfiled = useCallback(async () => {
    setSearching(true)
    try {
      const res = await fetch(
        `/api/thread-links?record_kind=${recordKind}&record_id=${recordId}&suggest=1`
      )
      if (!res.ok) throw new Error('Search failed')
      const data = (await res.json()) as { candidates: CorrespondenceThread[] }
      setCandidates(data.candidates)
      if (data.candidates.length === 0) toast.info('No unfiled mail matched this record.')
    } catch {
      toast.error('Could not search correspondence.')
    } finally {
      setSearching(false)
    }
  }, [recordKind, recordId])

  async function file(thread: CorrespondenceThread) {
    setBusy(thread.id)
    // Optimistic, with the candidate removed from the suggestion list so it
    // cannot be filed twice while the request is in flight.
    setCandidates((c) => c?.filter((t) => t.id !== thread.id) ?? null)
    setFiled((f) => [{ ...thread, certainty: 'linked' }, ...f])
    try {
      const res = await fetch('/api/thread-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_kind: recordKind, record_id: recordId, thread_id: thread.id }),
      })
      if (!res.ok) throw new Error()
      toast.success('Filed on this record.')
    } catch {
      setFiled((f) => f.filter((t) => t.id !== thread.id))
      setCandidates((c) => (c ? [thread, ...c] : c))
      toast.error('Could not file that thread.')
    } finally {
      setBusy(null)
    }
  }

  async function unfile(thread: CorrespondenceThread) {
    setBusy(thread.id)
    setFiled((f) => f.filter((t) => t.id !== thread.id))
    try {
      const res = await fetch(
        `/api/thread-links?record_kind=${recordKind}&record_id=${recordId}&thread_id=${thread.id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error()
      toast.success('Removed from this record.')
    } catch {
      setFiled((f) => [thread, ...f])
      toast.error('Could not remove that thread.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel>
      <PanelHeader label="Correspondence" count={filed.length}>
        <button
          onClick={findUnfiled}
          disabled={searching}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          {searching ? 'Searching…' : 'Find unfiled mail'}
        </button>
      </PanelHeader>

      <div className="p-4 space-y-4">
        {filed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No email is filed on this record yet. Most mail in the platform is unfiled — use
            &ldquo;Find unfiled mail&rdquo; to see what matches.
          </p>
        ) : (
          <ul className="space-y-2">
            {filed.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                busy={busy === t.id}
                action={
                  <button
                    onClick={() => unfile(t)}
                    title="Remove from this record"
                    className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <X size={13} />
                  </button>
                }
              />
            ))}
          </ul>
        )}

        {candidates && candidates.length > 0 && (
          <div className="rounded-md bg-muted/30 p-3">
            <p className="label-caps text-muted-foreground mb-2">
              Matched this record — not filed
            </p>
            <ul className="space-y-2">
              {candidates.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  busy={busy === t.id}
                  action={
                    <button
                      onClick={() => file(t)}
                      className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
                    >
                      <Plus size={11} /> File
                    </button>
                  }
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  )
}

function ThreadRow({
  thread,
  busy,
  action,
}: {
  thread: CorrespondenceThread
  busy: boolean
  action: React.ReactNode
}) {
  return (
    <li className={busy ? 'opacity-50' : undefined}>
      <div className="flex items-start gap-2.5">
        <Mail size={13} className="mt-1 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {thread.subject ?? '(no subject)'}
            </span>
            {thread.certainty === 'inferred' && (
              <Chip tone="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                matched
              </Chip>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {thread.last_at ? formatDate(thread.last_at) : 'undated'}
            {thread.mailbox ? ` · ${thread.mailbox}` : ''}
            {thread.message_count ? ` · ${thread.message_count} message${thread.message_count === 1 ? '' : 's'}` : ''}
            {thread.attachment_count ? (
              <span className="inline-flex items-center gap-0.5 ml-1">
                <Paperclip size={10} /> {thread.attachment_count}
              </span>
            ) : null}
          </p>
          {thread.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{thread.summary}</p>
          )}
        </div>
        {action}
      </div>
    </li>
  )
}
