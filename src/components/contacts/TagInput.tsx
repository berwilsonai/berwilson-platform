'use client'

import { useEffect, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  /** Existing tags across all contacts, for autocomplete. Pass counts to show usage. */
  suggestions?: Array<{ tag: string; count: number }>
  placeholder?: string
  disabled?: boolean
}

/**
 * Chip input for contact tags. Type to filter existing tags; pick one to
 * reuse it, or press Enter to create a new tag on the spot. The tag
 * vocabulary is whatever is in use — no admin screen.
 */
export default function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add a tag (Auditor, Plumber, Roofer…)',
  disabled = false,
}: TagInputProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const lowerValue = value.map(t => t.toLowerCase())
  const q = query.trim().toLowerCase()

  const matches = suggestions
    .filter(s => !lowerValue.includes(s.tag.toLowerCase()))
    .filter(s => !q || s.tag.toLowerCase().includes(q))
    .slice(0, 8)

  const exactExists =
    lowerValue.includes(q) || suggestions.some(s => s.tag.toLowerCase() === q)

  function addTag(tag: string) {
    const clean = tag.trim()
    if (!clean) return
    if (lowerValue.includes(clean.toLowerCase())) {
      setQuery('')
      return
    }
    onChange([...value, clean])
    setQuery('')
    inputRef.current?.focus()
  }

  function removeTag(tag: string) {
    onChange(value.filter(t => t !== tag))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Prefer the exact existing tag (canonical casing) over creating a variant
      const existing = suggestions.find(s => s.tag.toLowerCase() === q)
      addTag(existing?.tag ?? query)
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && value.length > 0) {
      removeTag(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 min-h-9 w-full rounded-md border border-input bg-background px-2 py-1.5',
          'focus-within:ring-2 focus-within:ring-ring',
          disabled && 'opacity-50 pointer-events-none'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-foreground"
          >
            <Tag size={9} className="text-muted-foreground shrink-0" />
            {tag}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); removeTag(tag) }}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Remove tag ${tag}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          autoComplete="off"
        />
      </div>

      {open && (matches.length > 0 || (q && !exactExists)) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover elev-2 max-h-56 overflow-y-auto">
          {matches.map(s => (
            <button
              key={s.tag}
              type="button"
              onClick={() => { addTag(s.tag); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <Tag size={12} className="text-muted-foreground shrink-0" />
              <span className="text-sm">{s.tag}</span>
              <span className="ml-auto text-xs text-muted-foreground tnum">{s.count}</span>
            </button>
          ))}
          {q && !exactExists && (
            <>
              {matches.length > 0 && <div className="border-t border-border" />}
              <button
                type="button"
                onClick={() => { addTag(query); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-primary"
              >
                <Tag size={12} className="shrink-0" />
                <span className="text-sm font-medium">Create &ldquo;{query.trim()}&rdquo;</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
