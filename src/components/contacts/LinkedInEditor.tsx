'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Link2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LinkedInEditorProps {
  partyId: string
  initialUrl: string | null
}

export default function LinkedInEditor({ partyId, initialUrl }: LinkedInEditorProps) {
  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState(initialUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/parties/${partyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedin_url: url || null }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setEditing(false)
      router.refresh()
    } catch {
      setError('Failed to save LinkedIn URL')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    if (!initialUrl) {
      return (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Link2 size={14} className="shrink-0" />
          Add LinkedIn
        </button>
      )
    }

    return (
      <div className="flex items-center gap-2.5">
        <Link2 size={14} className="text-muted-foreground shrink-0" />
        <a
          href={initialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm hover:underline flex items-center gap-1"
        >
          LinkedIn Profile
          <ExternalLink size={11} className="text-muted-foreground" />
        </a>
        <button
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground transition-colors ml-1"
          aria-label="Edit LinkedIn URL"
        >
          <Pencil size={11} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Link2 size={14} className="text-muted-foreground shrink-0" />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://linkedin.com/in/..."
          className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setUrl(initialUrl ?? '')
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
