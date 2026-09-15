'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X, ExternalLink, FileText } from 'lucide-react'
import { openDocumentById } from '@/lib/utils/document-links'

/**
 * The activity bell.
 *
 * Deliberately cheap on the common path: the unread count is resolved
 * server-side and handed in as a prop, so a page load costs nothing extra, and
 * the list itself is only fetched when the panel is opened. A short poll keeps
 * the count honest for someone who leaves a tab open all day.
 *
 * `setState` never runs synchronously inside an effect here — the poll sets it
 * from a timer callback, and everything else from an event handler. That keeps
 * this out of the react-hooks/set-state-in-effect class the repo already carries
 * twelve of.
 */

interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string | null
  href: string | null
  external_url: string | null
  actor_name: string | null
  document_id: string | null
  read_at: string | null
  created_at: string
}

/** Count refresh interval. Long enough to be invisible, short enough to notice. */
const POLL_MS = 90_000

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(initialUnread)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const data = await res.json()
        setRows(data.notifications ?? [])
        setUnread(data.unread ?? 0)
      }
    } catch {
      /* a bell that cannot reach the server stays as it was */
    } finally {
      setLoading(false)
    }
  }, [])

  // Count-only refresh on a timer and when the tab regains focus. Reuses the
  // same endpoint: the list is 25 rows at most, so a separate count route would
  // be a second endpoint to keep correct for no measurable saving.
  useEffect(() => {
    let cancelled = false
    async function refreshCount() {
      if (document.hidden) return
      try {
        const res = await fetch('/api/notifications')
        if (!res.ok || cancelled) return
        const data = await res.json()
        setUnread(data.unread ?? 0)
        // Only replace the list when nobody is reading it — swapping rows out
        // from under an open panel moves the thing being clicked.
        setRows((prev) => (panelRef.current ? prev : (data.notifications ?? [])))
      } catch {
        /* ignore */
      }
    }
    const timer = setInterval(refreshCount, POLL_MS)
    window.addEventListener('focus', refreshCount)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', refreshCount)
    }
  }, [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) void load()
  }

  async function markRead(id: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, read_at: new Date().toISOString() } : r)))
    setUnread((u) => Math.max(0, u - 1))
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    }).catch(() => {})
  }

  async function dismiss(id: string, wasUnread: boolean) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    if (wasUnread) setUnread((u) => Math.max(0, u - 1))
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    }).catch(() => {})
  }

  async function bulk(action: 'read_all' | 'dismiss_all') {
    if (action === 'dismiss_all') setRows([])
    else setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })))
    setUnread(0)
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => {})
  }

  function openRow(row: NotificationRow) {
    if (!row.read_at) void markRead(row.id)
    setOpen(false)
    if (row.href) router.push(row.href)
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={unread ? `Activity — ${unread} unread` : 'Activity'}
        title="Activity"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-semibold leading-[15px] text-center tnum">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-[min(92vw,22rem)] max-h-[70vh] flex flex-col rounded-xl border border-border bg-card elev-3 z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="label-caps text-muted-foreground">Activity</span>
            {rows.length > 0 && (
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button
                    onClick={() => bulk('read_all')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Mark read
                  </button>
                )}
                <button
                  onClick={() => bulk('dismiss_all')}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          <div className="overflow-y-auto scrollbar-thin">
            {loading && rows.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</p>
            )}
            {!loading && rows.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                Nothing new. Documents your teammates add show up here.
              </p>
            )}
            {rows.map((row) => (
              <div
                key={row.id}
                className={`group flex gap-2 px-3 py-2.5 border-b border-border/60 last:border-0 transition-colors ${
                  row.read_at ? 'hover:bg-accent' : 'bg-accent/60 hover:bg-accent'
                }`}
              >
                <button onClick={() => openRow(row)} className="flex-1 min-w-0 text-left">
                  <p className="text-[13px] font-medium text-foreground leading-snug break-words">
                    {!row.read_at && (
                      <span className="inline-block size-1.5 rounded-full bg-primary mr-1.5 align-middle" />
                    )}
                    {row.title}
                  </p>
                  {row.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-2 break-words">
                      {row.body}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">{relativeTime(row.created_at)}</p>
                </button>

                <div className="flex flex-col items-center gap-1 shrink-0">
                  <button
                    onClick={() => dismiss(row.id, !row.read_at)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <X size={13} />
                  </button>
                  {row.document_id && (
                    <button
                      onClick={() => void openDocumentById(row.document_id!)}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                      aria-label="Open the file"
                      title="Open the file"
                    >
                      <FileText size={13} />
                    </button>
                  )}
                  {row.external_url && (
                    <a
                      href={row.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                      aria-label="Open in Drive"
                      title="Open in Drive"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
