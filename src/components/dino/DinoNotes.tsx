'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export interface DinoNoteRow {
  id: string
  body: string
  author: string | null
  created_at: string | null
}

function when(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DinoNotes({ notes }: { notes: DinoNoteRow[] }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DinoNoteRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function add() {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      const res = await fetch('/api/dino/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Failed to add note' }))
        toast.error(error ?? 'Failed to add note')
        return
      }
      setBody('')
      router.refresh()
    } catch {
      toast.error('Failed to add note')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/dino/notes/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Delete failed')
        return
      }
      setDeleteTarget(null)
      router.refresh()
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card elev-1">
      <div className="px-4 py-2.5 border-b border-border">
        <h2 className="label-caps text-muted-foreground">Notes</h2>
      </div>
      <div className="p-3 space-y-3">
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Log a call, a handoff, integration progress…"
            className={cn(
              'w-full min-h-[56px] rounded-md border border-input bg-background px-2.5 py-2 text-xs',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y'
            )}
          />
          <button
            onClick={add}
            disabled={saving || !body.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Add note
          </button>
        </div>

        {notes.length > 0 && (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="group rounded-md bg-muted/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-foreground whitespace-pre-wrap flex-1 min-w-0">{n.body}</p>
                  <button
                    onClick={() => setDeleteTarget(n)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    aria-label="Delete note"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {[n.author, when(n.created_at)].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this note?"
        description="This cannot be undone."
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
