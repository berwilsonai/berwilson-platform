'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import type { OpportunityNote } from '@/lib/supabase/types'

function formatWhen(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface OpportunityNotesProps {
  opportunityId: string
  notes: OpportunityNote[]
}

export default function OpportunityNotes({ opportunityId, notes }: OpportunityNotesProps) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, author: author.trim() || undefined }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Failed to add note' }))
        setError(error ?? 'Failed to add note')
        return
      }
      setBody('')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Composer */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Log progress, a call, a decision, or a next step…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[72px] resize-y"
        />
        <div className="flex items-center gap-2">
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name (optional)"
            className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Add Note
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>

      {/* Feed */}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-foreground">
                  {note.author || 'Note'}
                </span>
                <span className="text-[11px] text-muted-foreground">{formatWhen(note.created_at)}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
