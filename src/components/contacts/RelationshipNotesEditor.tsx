'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updateContactNotes } from '@/app/contacts/actions'

interface RelationshipNotesEditorProps {
  partyId: string
  initialNotes: string | null
}

export default function RelationshipNotesEditor({
  partyId,
  initialNotes,
}: RelationshipNotesEditorProps) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  // Keep local state in sync if the server re-renders with new initialNotes
  useEffect(() => {
    if (!editing) setNotes(initialNotes ?? '')
  }, [initialNotes, editing])

  function handleSave() {
    setError('')
    startTransition(async () => {
      const formData = new FormData()
      formData.append('relationship_notes', notes)
      const result = await updateContactNotes(partyId, null, formData)
      if (result && 'error' in result) {
        setError(result.error)
      } else {
        setEditing(false)
        router.refresh()
      }
    })
  }

  if (!editing) {
    return (
      <div>
        <div className="min-h-[60px] text-sm text-foreground whitespace-pre-wrap">
          {notes || (
            <span className="text-muted-foreground italic">No relationship notes yet.</span>
          )}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil size={11} />
          Edit notes
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={6}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        placeholder="Notes about this relationship, how you know them, key context…"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setNotes(initialNotes ?? '')
            setError('')
          }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
