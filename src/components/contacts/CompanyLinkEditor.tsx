'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2, Pencil, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EntityHit {
  id: string
  name: string
  entity_type: string
  headquarters: string | null
}

interface CompanyLinkEditorProps {
  partyId: string
  linkedEntity: { id: string; name: string } | null
  /** Free-text company on the party when there is no entity link yet. */
  companyText: string | null
}

/**
 * Shows and edits the contact's company/vendor link on the detail page.
 * Picking a search hit links to that vendor; entering an unknown name
 * creates the vendor and links it; clearing removes the link.
 */
export default function CompanyLinkEditor({ partyId, linkedEntity, companyText }: CompanyLinkEditorProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<EntityHit[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/entities/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setResults(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInput(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 200)
  }

  async function save(payload: { entity_id?: string | null; company_name?: string }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/parties/${partyId}/company`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? 'Failed to update company')
        return
      }
      setEditing(false)
      setQuery('')
      setResults([])
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const showCreate =
    query.trim().length > 0 &&
    !results.some(r => r.name.toLowerCase() === query.trim().toLowerCase())

  if (!editing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        {linkedEntity ? (
          <Link
            href={`/vendors/${linkedEntity.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline min-w-0"
          >
            <Building2 size={13} className="shrink-0" />
            <span className="truncate">{linkedEntity.name}</span>
          </Link>
        ) : companyText ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
            <Building2 size={13} className="shrink-0" />
            <span className="truncate">{companyText}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground italic">No company linked.</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Edit company link"
        >
          <Pencil size={12} />
        </button>
        {(linkedEntity || companyText) && (
          <button
            type="button"
            disabled={saving}
            onClick={() => save({ entity_id: null })}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0 disabled:opacity-50"
            aria-label="Remove company link"
            title="Remove company link"
          >
            <X size={12} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={e => handleInput(e.target.value)}
        placeholder="Search or type company name…"
        autoFocus
        disabled={saving}
        className={cn(
          'h-8 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
          'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
        )}
        autoComplete="off"
      />
      {query.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover elev-2 max-h-56 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
          {results.map(entity => (
            <button
              key={entity.id}
              type="button"
              disabled={saving}
              onClick={() => save({ entity_id: entity.id })}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
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
          {showCreate && (
            <>
              {results.length > 0 && <div className="border-t border-border" />}
              <button
                type="button"
                disabled={saving}
                onClick={() => save({ company_name: query.trim() })}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-primary disabled:opacity-50"
              >
                <Plus size={14} className="shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Create &ldquo;{query.trim()}&rdquo;</p>
                  <p className="text-xs text-muted-foreground">Add as new vendor and link</p>
                </div>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
