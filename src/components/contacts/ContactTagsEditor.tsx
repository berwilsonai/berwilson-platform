'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import TagInput from './TagInput'

interface ContactTagsEditorProps {
  partyId: string
  initialTags: string[]
}

/** Tags on the contact detail page — saves on every add/remove. */
export default function ContactTagsEditor({ partyId, initialTags }: ContactTagsEditorProps) {
  const [tags, setTags] = useState(initialTags)
  const [suggestions, setSuggestions] = useState<Array<{ tag: string; count: number }>>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/parties/tags')
      .then(res => (res.ok ? res.json() : { tags: [] }))
      .then(data => { if (!cancelled) setSuggestions(data.tags ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  async function handleChange(next: string[]) {
    const previous = tags
    setTags(next)
    const res = await fetch(`/api/parties/${partyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: next }),
    })
    if (!res.ok) {
      setTags(previous)
      toast.error('Failed to save tags')
    }
  }

  return <TagInput value={tags} onChange={handleChange} suggestions={suggestions} />
}
