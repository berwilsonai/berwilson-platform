'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Building2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Entity {
  id: string
  name: string
  entity_type: string
  headquarters: string | null
}

interface CompanyAutocompleteProps {
  inputClass: string
}

export default function CompanyAutocomplete({ inputClass }: CompanyAutocompleteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Entity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/entities/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (value: string) => {
    setQuery(value)
    setSelectedEntity(null)
    setIsOpen(true)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 200)
  }

  const selectEntity = (entity: Entity) => {
    setSelectedEntity(entity)
    setQuery(entity.name)
    setIsOpen(false)
    inputRef.current?.blur()
  }

  const clearSelection = () => {
    setSelectedEntity(null)
    setQuery('')
    setResults([])
    inputRef.current?.focus()
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const showCreateOption = query.trim().length > 0 && !results.some(
    r => r.name.toLowerCase() === query.trim().toLowerCase()
  )

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden inputs that get submitted with the form */}
      <input type="hidden" name="entity_id" value={selectedEntity?.id ?? ''} />
      <input type="hidden" name="company" value={query.trim()} />

      {/* Visible input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { if (query.length > 0) setIsOpen(true) }}
          placeholder="Search or type company name…"
          className={cn(inputClass, selectedEntity && 'pr-16')}
          autoComplete="off"
        />
        {selectedEntity && (
          <button
            type="button"
            onClick={clearSelection}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground bg-muted px-1.5 py-0.5 rounded"
          >
            Clear
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (query.length > 0) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-56 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          )}

          {!loading && results.length === 0 && !showCreateOption && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matches found</div>
          )}

          {results.map(entity => (
            <button
              key={entity.id}
              type="button"
              onClick={() => selectEntity(entity)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
            >
              <Building2 size={14} className="text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{entity.name}</p>
                <p className="text-xs text-muted-foreground">
                  {entity.entity_type.toUpperCase()}
                  {entity.headquarters && ` · ${entity.headquarters}`}
                </p>
              </div>
            </button>
          ))}

          {showCreateOption && (
            <>
              {results.length > 0 && <div className="border-t border-border" />}
              <button
                type="button"
                onClick={() => {
                  // No entity selected — the server action will auto-create
                  setSelectedEntity(null)
                  setIsOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-primary"
              >
                <Plus size={14} className="shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Create &ldquo;{query.trim()}&rdquo;</p>
                  <p className="text-xs text-muted-foreground">Add as new company</p>
                </div>
              </button>
            </>
          )}
        </div>
      )}

      {/* Visual indicator when linked to existing entity */}
      {selectedEntity && (
        <p className="mt-1 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <Building2 size={10} />
          Linked to existing vendor record
        </p>
      )}
    </div>
  )
}
